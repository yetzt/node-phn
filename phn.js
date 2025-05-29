const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const http2 = require("node:http2");
const tls = require("node:tls");

const qs = require("node:querystring");
const zlib = require("node:zlib");
const { URL } = require("node:url");

// shim for zstd, uses fzstd if installed
const createZstdDecompress = zlib.createZstdDecompress || (()=>{
	try {
		const fzstd = require("fzstd");
		const transformStream = require("node:stream").Transform;
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
		}, () => {
			alpnCache[url.origin] = socket.alpnProtocol;
			resolve(socket.alpnProtocol);
			socket.destroy();
		});
	});
};

// helper: http2 sessions
const http2Sessions = {};
async function http2Session(url, opts){
	if (url.origin in http2Sessions && !http2Sessions[url.origin].destroyed && !http2Sessions[url.origin].closed && !http2Sessions[url.origin].destroying) return http2Sessions[url.origin];
	return (http2Sessions[url.origin] = http2.connect(`${url.origin}`, opts));
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
const phn = async (opts, fn)=>{

	// callback compat
	if (typeof fn === "function") return await phn(opts).then(data=>(fn(null, data))).catch(fn);

	if (typeof opts === "string") opts = { url: opts };
	if (!("url" in opts) || !opts.url) throw new Error("Missing url option from options for request method.");

	this.url = (typeof opts.url === "string") ? new URL(opts.url) : opts.url;
	this.method = (opts.method || "get").toUpperCase();
	this.data = null;

	// maximum buffer size
	this.maxBuffer = parseInt(opts.maxBuffer,10) || Infinity;

	// max redirects
	this.maxRedirects = (typeof opts?.maxRedirects === "number") ? opts.maxRedirects : (typeof opts?.follow === "number") ? opts.follow : 20;
	opts.redirected = opts.redirected || 0;

	// http2 options
	this.http2core = (typeof opts.http2 === "object") ? opts.http2 : {};

	// headers
	this.headers = {};
	if (opts.headers) for (const [k,v] of Object.entries(opts.headers)) this.headers[k.toLowerCase()] = v;

	// query
	if (opts.query) for (const [k,v] of Object.entries(opts.headers)) this.url.searchParams.append(k,v);

	// form
	if (opts.form) {
		this.data = qs.stringify(opts.form);
		this.headers["content-type"] = "application/x-www-form-urlencoded";
	};

	// data
	if (opts.data) {
		if (typeof opts.data === "object" && !Buffer.isBuffer(opts.data) && !ArrayBuffer.isView(opts.data)) { // json
			this.data = JSON.stringify(opts.data);
			this.headers["content-type"] = "application/json";
		} else {
			this.data = opts.data;
			if (!this.headers["content-type"]) this.headers["content-type"] = "application/octet-stream";
		}
	};

	// set content-length
	if (this.data && !this.headers["content-length"]) this.headers["content-length"] = Buffer.byteLength(this.data);

	// compression, set unless explicitly off
	if ((!("compression" in opts) || !!opts.compression) && !this.headers["accept-encoding"]) this.headers["accept-encoding"] = (typeof opts.compression === "string") ? opts.compression : supportedCompression;

	// send request
	let { transport, req, res, stream, client } = await new Promise(async (resolve, reject)=>{

		// assemble options for http1
		const options = {
			protocol: this.url.protocol,
			host: this.url.hostname.replace("[", "").replace("]", ""),
			port: this.url.port,
			path: this.url.pathname + (this.url.search ?? ""),
			method: this.method,
			headers: this.headers,
			agent: httpAgent(this.url.protocol),
			...opts.core,
		};

		let req;
		switch (this.url.protocol) {
			case "http:":
				req = http.request(options, res=>resolve({ transport: "http", req, res, stream: res }));
			break;
			case "https:":

				// use http2 if module is loaded, http2 not explicitly off and available on host
				if (http2 && (!("http2" in opts) || !!opts.http2) && ("h2" === await alpn(this.url))) {

					// new http2 session
					const client = await http2Session(this.url, this.coreOptions);

					// reference socket
					client.socket.ref();

					req = client.request({ ":method": options.method, ":path": options.path, ...options.headers, ...this.http2core });

					req.on("response", (headers) => {
						const res = { headers, statusCode: headers[":status"] };
						resolve({ transport: "http2", req, res, stream: req, client });
					});

				} else {
					req = https.request(options, res=>{
						resolve({ transport: "https", req, res, stream: res })
					});
				};

			break;
			default:
				return reject(new Error(`Bad protocol: ${this.url.protocol}`));
			break;
		};

		// handle timeout
		if (opts.timeout) req.setTimeout(opts.timeout);
		req.on("timeout", ()=>{
			reject(new Error("Timeout reached"));
			req.abort();
		});

		// handle error
		req.on("error", reject);

		// send data
		if (this.data) req.write(this.data);

		// end request
		req.end();

	});

	// follow redirects
	if (res.headers?.location && (opts.follow || opts.followRedirects)) {

		// limit the number of redirects
		if (this.maxRedirects && ++opts.redirected > this.maxRedirects) throw new Error("Exceeded the maximum number of redirects");

		const redirectedUrl = new URL(res.headers["location"], this.url);
		if (redirectedUrl.protocol === this.url.protocol && redirectedUrl.host === this.url.host) { // keep cookies
			if (res.headers["set-cookie"]) opts.headers = { ...opts.headers, cookie: res.headers["set-cookie"] };
		} else { // remove spicy request headers
			opts.headers = Object.entries({ ...opts.headers }).reduce((h,[k,v])=>{
				if (!["authorization","cookie","proxy-authorization"].includes(k.toLowerCase())) h[k] = v;
				return h;
			},{});
		};
		opts.url = redirectedUrl.toString();

		return phn(opts, fn);
	};

	// check content-length header against maxBuffer
	if (res.headers["content-length"] && parseInt(res.headers["content-length"],10) > this.maxBuffer) {
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

	// IDEA: iconv decode via iconv-lite shim?

	// deliver stream if requested
	if (opts.stream) {
		client?.unref?.();
		return { ...res, req, transport, stream, statusCode: res.statusCode };
	};

	// assemble body
	let body = await new Promise((resolve,reject)=>{
		let b = Buffer.alloc(0);

		stream.on("error", err=>reject(err));
		stream.on("aborted", ()=>reject(new Error("Server aborted request")));

		stream.on("data", chunk=>{
			b = Buffer.concat([b, chunk]);
			if (b.length > opts.maxBuffer) {
				reject(new Error(`Content length exceeds maxBuffer: ${res.headers["content-length"]}b`));
				stream.destroy();
			};
		});

		stream.on("end", ()=>{
			client?.unref?.();
			resolve(b);
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
	return { ...res, req, transport, body, statusCode: res.statusCode };

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