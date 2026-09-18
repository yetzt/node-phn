const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const http2 = require("node:http2");
const tls = require("node:tls");
const transformStream = require("node:stream").Transform;

const qs = require("node:querystring");
const zlib = require("node:zlib");
const { URL } = require("node:url");

// shim for zstd, uses fzstd if installed
const createZstdDecompress = zlib.createZstdDecompress || (()=>{
	try {
		const fzstd = require("fzstd");
		return ()=>{
			return new transformStream({
				transform(chunk, encoding, fn) {
					try {
						if (!this.zstd) this.zstd = new fzstd.Decompress((ch, end) => {
							this.push(ch);
							if (end) this.push(null);
						});
						this.zstd.push(chunk);
						fn();
					} catch (err) {
						fn(err);
					};
				},
				flush() {
					this.zstd.push(Buffer.alloc(0), true);
				}
			});
		};
	} catch (err) {
		return null;
	};
})();

// shim for iconv-lite
const iconv = (()=>{
	try {
		return require("iconv-lite");
	} catch (err) {
		return null;
	};
})();

// find available encodings
const supportedCompression = [
	(!!createZstdDecompress && "zstd"),
	(!!zlib.createBrotliDecompress && "br"),
	(!!zlib.createGunzip && "gzip"),
	(!!zlib.createInflate && "deflate")
].filter(Boolean).join(", ");

// helper: alpn request
const alpnCache = {};
async function alpn(url) {
	return new Promise((resolve) => {
		if (alpnCache[url.origin]) return resolve(alpnCache[url.origin]);
		const socket = tls.connect({
			host: url.hostname,
			port: url.port || 443,
			servername: url.hostname,
			ALPNProtocols: ["h2", "http/1.1"],
		});

		const settle = (proto) => {
			if (!alpnCache[url.origin]) alpnCache[url.origin] = proto || "http/1.1";
			try { socket.destroy(); } catch {}
			resolve(alpnCache[url.origin]);
		};

		socket.setTimeout?.(5000, () => settle("http/1.1"));
		socket.once("secureConnect", () => settle(socket.alpnProtocol));
		socket.once("error", () => settle("http/1.1"));
	});
};

// helper: http2 sessions
const http2Sessions = {};
const http2SessionRequests = new WeakMap();
async function http2Session(url, opts){
	if (url.origin in http2Sessions && !http2Sessions[url.origin].destroyed && !http2Sessions[url.origin].closed && !http2Sessions[url.origin].destroying) return http2Sessions[url.origin];
	return (http2Sessions[url.origin] = http2.connect(`${url.origin}`, opts));
};

// keep track of http2 clients per session, unref only if no more clients are active
function refHttp2Session(client) {
	const requests = http2SessionRequests.get(client) || 0;
	if (!requests) client.socket.ref();
	http2SessionRequests.set(client, requests + 1);

	let released = false;
	return () => {
		if (released) return;
		released = true;
		const remaining = http2SessionRequests.get(client) - 1;
		http2SessionRequests.set(client, remaining);
		if (!remaining) client.socket.unref();
	};
};

// helper: http(s) sessions
const agents = {};
function httpAgent(p){
	if (!agents[p] || agents[p].destroyed) agents[p] = new (p === "http:" ? http : https).Agent({ keepAlive: true });
	return agents[p];
};

// clean up sessions on exit
process.on("exit", ()=>{
	for (const client of Object.values(http2Sessions)) client.close();
});

// phn
const phn = async function(opts, fn){

	// callback compat
	if (typeof fn === "function") return await phn(opts).then(data=>(fn(null, data))).catch(fn);

	opts = (typeof opts === "string") ? { url: opts } : { ...opts, headers: opts.headers ? { ...opts.headers } : {} };
	if (!("url" in opts) || !opts.url) throw new Error("Missing url option from options for request method.");

	const url = (typeof opts.url === "string") ? new URL(opts.url) : opts.url;
	const method = (opts.method || "get").toUpperCase();
	let data = null;

	// maximum buffer size
	const maxBuffer = parseInt(opts.maxBuffer,10) || Infinity;

	// max redirects
	const maxRedirects = (typeof opts?.maxRedirects === "number") ? opts.maxRedirects : (typeof opts?.follow === "number") ? opts.follow : 20;
	opts.redirected = opts.redirected || 0;

	// http2 options
	const http2core = (typeof opts.http2 === "object") ? opts.http2 : {};

	// headers
	const headers = {};
	if (opts.headers) for (const [k,v] of Object.entries(opts.headers)) headers[k.toLowerCase()] = v;

	// query
	if (opts.query) for (const [k,v] of Object.entries(opts.query)) url.searchParams.append(k,v);

	// form
	if (opts.form) {
		data = qs.stringify(opts.form);
		headers["content-type"] = "application/x-www-form-urlencoded";
	};

	// data
	if (opts.data !== undefined && opts.data !== null) {
		if (typeof opts.data === "object" && !Buffer.isBuffer(opts.data) && !ArrayBuffer.isView(opts.data)) { // json
			data = JSON.stringify(opts.data);
			headers["content-type"] = "application/json";
		} else {
			data = opts.data;
			if (!headers["content-type"]) headers["content-type"] = "application/octet-stream";
		}
	};

	// set content-length
	if (data !== null && !headers["content-length"]) headers["content-length"] = Buffer.byteLength(data);

	// compression, set unless explicitly off
	if ((!("compression" in opts) || !!opts.compression) && !headers["accept-encoding"]) headers["accept-encoding"] = (typeof opts.compression === "string") ? opts.compression : supportedCompression;

	// send request
	let { transport, req, res, stream, client, ref } = await new Promise(async (resolve, reject)=>{

		let transport;

		// assemble options for http1
		const options = {
			protocol: url.protocol,
			host: url.hostname.replace("[", "").replace("]", ""),
			port: url.port,
			path: url.pathname + (url.search ?? ""),
			method,
			headers,
			agent: httpAgent(url.protocol),
			...opts.core,
		};

		let req, ref;
		switch (url.protocol) {
			case "http:":
				transport = "http";
				req = http.request(options, res=>resolve({ transport, req, res, stream: res }));
			break;
			case "https:":

				// use http2 if module is loaded, http2 not explicitly off and available on host
				if (http2 && (!("http2" in opts) || !!opts.http2) && ("h2" === await alpn(url))) {
					transport = "http2";

					// new http2 session
					const client = await http2Session(url);

					// reference to shared http2 sessions, call to unref if unrefable
					ref = refHttp2Session(client);

					req = client.request({ ":method": options.method, ":path": options.path, ...options.headers, ...http2core });

					req.on("response", (headers) => {
						const res = { headers, statusCode: headers[":status"] };
						resolve({ transport, req, res, stream: req, client, ref });
					});

				} else {
					transport = "https";

					req = https.request(options, res=>{
						resolve({ transport, req, res, stream: res })
					});
				};

			break;
			default:
				return reject(new Error(`Bad protocol: ${url.protocol}`));
			break;
		};

		// handle timeout
		if (opts.timeout) req.setTimeout(opts.timeout);
		req.on("timeout", ()=>{
			ref?.();
			reject(new Error("Timeout reached"));
			(transport === "http2") ? req.close(http2.constants.NGHTTP2_CANCEL) : req.abort?.();
		});

		// handle error
		req.on("error", err=>{
			ref?.();
			reject(err);
		});

		// send data
		if (data !== null) req.write(data);

		// end request
		req.end();

	});

	// follow redirects
	if (res.headers?.location && (opts.follow || opts.followRedirects)) {

		// limit the number of redirects
		if (maxRedirects && ++opts.redirected > maxRedirects) throw new Error("Exceeded the maximum number of redirects");

		const redirectedUrl = new URL(res.headers["location"], url);
		if (redirectedUrl.protocol === url.protocol && redirectedUrl.host === url.host) { // keep cookies
			if (res.headers["set-cookie"]) opts.headers = { ...opts.headers, cookie: res.headers["set-cookie"] };
		} else { // remove spicy request headers
			opts.headers = Object.entries({ ...opts.headers }).reduce((h,[k,v])=>{
				if (!["authorization","cookie","proxy-authorization"].includes(k.toLowerCase())) h[k] = v;
				return h;
			},{});
		};

		// end stream before redirect
		(transport === "http2") ? stream.close(http2.constants.NGHTTP2_CANCEL) : stream.resume();

		ref?.();
		return phn({ ...opts, url: redirectedUrl.toString() }, fn);
	};

	// check content-length header against maxBuffer
	if (res.headers["content-length"] && parseInt(res.headers["content-length"],10) > maxBuffer) {
		ref?.();
		throw new Error(`Content length exceeds maxBuffer: ${res.headers["content-length"]}b`);
	};

	// decompress
	switch (res.headers["content-encoding"]) {
		case "zstd":
			stream = stream.pipe(createZstdDecompress());
		break;
		case "br":
			stream = stream.pipe(zlib.createBrotliDecompress());
		break;
		case "gzip":
			stream = stream.pipe(zlib.createGunzip());
		break;
		case "deflate":
			stream = stream.pipe(zlib.createInflate());
		break;
	};

	// iconv decode via iconv-lite if available
	if (iconv && opts.decode) { // iconv.encodingExists("us-ascii")
		const charset = (typeof opts.decode === "string") ? opts.decode : res.headers?.['content-type']?.match(/charset=([^;]+)/i)?.[1].trim();
		if (charset) {
			if (!iconv.encodingExists(charset)) throw new Error(`Unknown Charset ${charset}`);
			stream = stream.pipe(iconv.decodeStream(charset)).pipe(new transformStream({
				transform(c, _, f) { f(null, Buffer.from(c)); }
			}));
		};
	};

	// deliver stream if requested
	if (opts.stream) {
		if (ref) {
			stream.once("end", ref);
			stream.once("error", ref);
			stream.once("close", ref);
		};
		return { ...res, req, transport, stream, statusCode: res.statusCode, headers: res.headers };
	};

	// assemble body
	let body = await new Promise((resolve,reject)=>{
		const chunks = [];
		let cl = 0;

		stream.on("error", err=>{
			ref?.();
			reject(err);
		});
		stream.on("aborted", ()=>{
			ref?.();
			reject(new Error("Server aborted request"));
		});
		if (ref) stream.on("close", ref);

		stream.on("data", chunk=>{
			cl += chunk.length;
			if (cl > maxBuffer) return reject(new Error(`Content length exceeds maxBuffer: ${cl}b`)), stream.destroy();
			chunks.push(chunk);
		});

		stream.on("end", ()=>{
			ref?.();
			resolve(Buffer.concat(chunks, cl));
		});

	});

	// parse body
	switch (typeof opts.parse) {
		case "string":
			switch (opts.parse) {
				case "string":
					body = body.toString()
				break;
				case "json":
					body = (res.statusCode === 204) ? null : JSON.parse(body);
				break;
			};
		break;
		case "function":
			body = opts.parse(body);
		break;
	};

	// deliver
	return { ...res, req, transport, body, statusCode: res.statusCode, headers: res.headers };

};

// defaults
phn.defaults = (defaults)=>(opts,fn)=>{
	if (typeof opts === "string") opts = { url: opts };
	for (const k of Object.keys(defaults)) if (!(k in opts)) opts[k] = defaults[k];
	return phn(opts,fn);
};

// compat
phn.promisified = phn;
phn.unpromisified = phn;

module.exports = phn;

// clean sessions and agents on exit
process.on("beforeExit", ()=>{
	for (const s of Object.values(http2Sessions)) try { s.close(); } catch {};
	for (const a of Object.values(agents)) try { a.destroy(); } catch {};
});
