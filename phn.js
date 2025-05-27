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

// helper: http2 client
const http2Clients = {};
async function http2Client(url, opts){
	if (url.origin in http2Clients && !http2Clients[url.origin].destroyed && !http2Clients[url.origin].closed && !http2Clients[url.origin].destroying) return http2Clients[url.origin];
	return (http2Clients[url.origin] = http2.connect(`${url.origin}`, opts));
};

// clean up clients on exit
process.on("exit", ()=>{
	for (const client of Object.values(http2Clients)) client.close();
});

// phn
const phn = async (opts, fn)=>{

	// callback compat
	if (typeof fn === "function") return await phn(opts).then(data=>(fn(null, data))).catch(fn);

	if (typeof opts === "string") opts = { url: opts };
	if (!("url" in opts) || !opts.url) throw new Error("Missing url option from options for request method.");

	this.url = (typeof opts.url === "string") ? new URL(opts.url) : opts.url;
	this.method = (opts.method || "GET");
	this.data = null;

	// assign maximum buffer size
	this.maxBuffer = parseInt(opts.maxBuffer,10) || 5e7;

	// http2 options
	this.http2core = (typeof opts.http2 === "object") ? opts.http2 : {};

	// headers
	this.reqHeaders = {};
	if (opts.headers) for (const [k,v] of Object.entries(opts.headers)) this.reqHeaders[k.toLowerCase()] = v;

	// query
	if (opts.query) for (const [k,v] of Object.entries(opts.headers)) this.url.searchParams.append(k,v);

	// form
	if (opts.form) {
		this.data = qs.stringify(opts.form);
		this.reqHeaders["content-type"] = "application/x-www-form-urlencoded";
	};

	// data
	if (opts.data) {
		if (typeof opts.data === "object" && !Buffer.isBuffer(opts.data) && !ArrayBuffer.isView(opts.data)) { // json
			this.data = JSON.stringify(opts.data);
			this.reqHeaders["content-type"] = "application/json";
		} else {
			this.data = opts.data;
			if (!this.reqHeaders["content-type"]) this.reqHeaders["content-type"] = "application/octet-stream";
		}
	};

	// set content-length
	if (this.data && !this.reqHeaders["content-length"]) this.reqHeaders["content-length"] = Buffer.byteLength(this.data);

	// compression, set unless explicitly off
	if ((!("compression" in opts) || !!opts.compression) && !this.reqHeaders["accept-encoding"]) this.reqHeaders["accept-encoding"] = (typeof opts.compression === "string") ? opts.compression : supportedCompression;

	// send request
	let { transport, req, res, stream, client } = await new Promise(async (resolve, reject)=>{

		// assemble options
		const options = Object.assign({
			"protocol": this.url.protocol,
			"host": this.url.hostname.replace("[", "").replace("]", ""),
			"port": this.url.port,
			"path": this.url.pathname + (this.url.search === null ? "" : this.url.search),
			"method": this.method,
			"headers": this.reqHeaders
		}, opts.core);

		let req;
		switch (this.url.protocol) {
			case "http:":
				// FIXME core opts, use own agent with keepalive
				req = http.request(options, res=>resolve({ transport: "http", req, res, stream: res, wtf: "bbq" }));
			break;
			case "https:":

				// use http2 if module is loaded, http2 not explicitly off and available on host
				if (http2 && (!("http2" in opts) || !!opts.http2) && ("h2" === await alpn(this.url))) {

					// new http2 session
					const client = await http2Client(this.url, this.coreOptions);

					// reference socket
					client.socket.ref();

					req = client.request({ ":method": options.method, ":path": options.path, ...options.headers, ...this.http2core });

					req.on("response", (headers) => {
						const res = { headers, statusCode: headers[":status"] };
						resolve({ transport: "http2", req, res, stream: req, client });
					});

				} else {
					// FIXME core opts, use own agent with keepalive
					req = https.request(options, res=>{
						resolve({ transport: "https", req, res, stream: res })
					});
				};

			break;
			default:
				return reject(new Error(`Bad URL protocol: ${this.url.protocol}`));
			break;
		};

		// handle timeout
		if (opts.timeout) req.setTimeout(opts.timeout);
		req.on("timeout", ()=>{
			req.abort();
			reject(new Error("Timeout reached"));
		});

		// handle error
		req.on("error", reject);

		// send data
		if (this.data) req.write(this.data);

		// end request
		req.end();

	});

	// follow redirects
	if ("location" in res.headers && opts.followRedirects) {
		// limit the number of redirects
		if (opts.maxRedirects && ++opts.redirected > opts.maxRedirects) throw new Error("Exceeded the maximum number of redirects");
		opts.url = (new URL(res.headers["location"], opts.url)).toString();
		return phn(opts, fn);
	};

	// check content-length header against maxBuffer
	if (res.headers["content-length"] && parseInt(res.headers["content-length"],10) > this.maxBuffer) {
		throw new Error(`Content length exceeds maxBuffer. (${res.headers["content-length"]} bytes)`);
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

	// IDEA: iconv decode?

	// deliver stream if requested
	if (opts.stream) {
		if (client && "unref" in client) client.unref();
		return { ...res, req, transport, stream, statusCode: res.statusCode };
	};

	// assemble body
	let body = await new Promise((resolve,reject)=>{
		let body = Buffer.alloc(0);

		stream.on("error", err=>reject(err));
		stream.on("aborted", ()=>reject(new Error("Server aborted request")));

		stream.on("data", chunk=>{
			body = Buffer.concat([body, chunk]);
			if (body.length > opts.maxBuffer) {
				reject(new Error(`Received a response which was longer than acceptable when buffering. (${res.headers["content-length"]} bytes)`));
				stream.destroy();
			};
		});

		stream.on("end", ()=>{
			if (client && "unref" in client) client.unref();
			resolve(body);
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
