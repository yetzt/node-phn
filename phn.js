const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const http2 = require("node:http2");
const tls = require("node:tls");

const qs = require("node:querystring");
const zlib = require("node:zlib");
const transformStream = require("node:stream").Transform;
const { URL } = require("node:url");

const supportedCompression = [
	(!!zlib.createZstdDecompress && "zstd"),
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
			ALPNProtocols: ['h2', 'http/1.1'],
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

// response class
const response = class response {

	constructor(res, resOptions) {
		this.coreRes = res;
		this.resOptions = resOptions;

		this.body = Buffer.alloc(0);

		this.headers = res.headers;
		this.statusCode = res.statusCode;
	};

	_addChunk(chunk) {
		this.body = Buffer.concat([this.body, chunk]);
	};

	async json() {
		return this.statusCode === 204 ? null : JSON.parse(this.body);
	};

	async text() {
		return this.body.toString();
	};

};

// request class
const request = class request {

	constructor(url, method = 'GET') {
		this.url = (typeof url === 'string') ? new URL(url) : url;
		this.method = method;
		this.data = null;
		this.sendDataAs = null;
		this.reqHeaders = {};
		this.streamEnabled = false;
		this.timeoutTime = null;
		this.coreOptions = {};
		this.resOptions = { maxBuffer: 5e7 };
		this.config = { http2: true };

		// enable compression if supported
		if (supportedCompression) {
			this.compressionEnabled = true;
			this.header('accept-encoding', supportedCompression);
		};

		return this;
	};

	query(key, value) {
		if (typeof key === 'object') Object.entries(key).forEach(([queryKey, queryValue])=>{
			this.url.searchParams.append(queryKey, queryValue);
		});
		else this.url.searchParams.append(key, value);
		return this;
	};

	path(relativePath) {
		this.url.pathname = path.join(this.url.pathname, relativePath);
		return this;
	};

	body(data, sendAs) {
		this.sendDataAs = (sendAs) ? sendAs.toLowerCase() : (typeof data === 'object' && !Buffer.isBuffer(data)) ? 'json' : 'buffer';

		switch (this.sendDataAs) {
			case 'form':
				this.data = qs.stringify(data);
			break;
			case 'json':
				this.data = JSON.stringify(data);
			break;
			default:
				this.data = data;
			break;
		};
		return this;
	};

	header(key, value) {
		if (typeof key === 'object') Object.entries(key).forEach(([headerName, headerValue])=>{
			this.reqHeaders[headerName.toLowerCase()] = headerValue;
		}); else this.reqHeaders[key.toLowerCase()] = value;
		return this;
	};

	timeout(timeout) {
		this.timeoutTime = timeout;
		return this;
	};

	option(name, value) {
		this.coreOptions[name] = value;
		return this;
	};

	configure(name, value) {
		this.config[name] = value;
		return this;
	};

	resOption(name, value) {
		this.resOptions[name] = value;
		return this;
	};

	stream() {
		this.streamEnabled = true;
		return this;
	};

	compress(compressions) {
		this.compressionEnabled = !!compressions; // oof
		if (!this.reqHeaders['accept-encoding']) this.reqHeaders['accept-encoding'] = (typeof compressions === "string") ? compressions : supportedCompression;
		return this;
	};

	send () {
		return new Promise(async (resolve, reject)=>{
			if (this.data) {
				if (!this.reqHeaders.hasOwnProperty('content-type')) {
					switch (this.sendDataAs) {
						case 'json':
							this.reqHeaders['content-type'] = 'application/json';
						break;
						case 'form':
							this.reqHeaders['content-type'] = 'application/x-www-form-urlencoded';
						break;
					};
				};

				if (!this.reqHeaders.hasOwnProperty('content-length')) {
					this.reqHeaders['content-length'] = Buffer.byteLength(this.data);
				};
			};

			const options = Object.assign({
				'protocol': this.url.protocol,
				'host': this.url.hostname.replace('[', '').replace(']', ''),
				'port': this.url.port,
				'path': this.url.pathname + (this.url.search === null ? '' : this.url.search),
				'method': this.method,
				'headers': this.reqHeaders
			}, this.coreOptions);

			let req;

			const resHandler = (res, stream, socket)=>{

				if (this.compressionEnabled) {
					switch (res.headers['content-encoding']) {
						case "zstd":
							stream = stream.pipe(zlib.createZstdDecompress());
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
				};

				if (this.streamEnabled) {
					res.stream = stream;
					resolve(res);
					if (socket) socket.unref();
					return;
				};

				let resp = new response(res, this.resOptions);

				stream.on('error', err=>{
					reject(err);
				});

				stream.on('aborted', ()=>{
					reject(new Error('Server aborted request'));
				});

				stream.on('data', chunk=>{
					resp._addChunk(chunk);

					if (this.resOptions.maxBuffer !== null && resp.body.length > this.resOptions.maxBuffer) {
						reject(new Error('Received a response which was longer than acceptable when buffering. (' + resp.body.length + ' bytes)'));
						stream.destroy();
					};
				});

				stream.on('end', ()=>{
					resolve(resp);
					if (socket) socket.unref();
				});

			};

			switch (this.url.protocol) {
				case 'https:':
					if (http2 && this.config.http2 && ("h2" === await alpn(this.url))) {

						const client = await http2Client(this.url, this.coreOptions);

						// reference socket
						client.socket.ref();

						req = client.request({
							':method': this.method,
							':path': this.url.pathname + this.url.search,
							...this.reqHeaders
						});

						req.on('response', (headers) => {
							const res = { headers, statusCode: headers[':status'] };
							resHandler(res, req, client.socket);
						});

					} else {
						req = https.request(options, res=>resHandler(res, res));
					};

				break;
				case 'http:':
					req = http.request(options, res=>resHandler(res, res));
				break;
				default:
					reject(new Error('Bad URL protocol: ' + this.url.protocol));
				break;
			};

			if (this.timeoutTime) req.setTimeout(this.timeoutTime);

			req.on('timeout', err=>{
				req.abort();
				reject(err || new Error('Timeout reached'));
			});

			req.on('error', err=>{
				reject(err);
			});

			if (this.data) req.write(this.data);

			req.end();
		});
	};
};

// phn
const phn = async (opts, fn)=>{

	// callback compat
	if (typeof fn === "function") return await phn(opts).then(data=>(fn(null, data))).catch(fn);

	if (typeof opts === 'string') opts = { url: opts };
	if (!opts.hasOwnProperty('url') || !opts.url) throw new Error('Missing url option from options for request method.');

	const req = new request(opts.url, opts.method || 'GET');

	// FIXME this is vaguely stupid, refactor with less function calls
	if (opts.headers) req.header(opts.headers);
	if (opts.stream) req.stream();
	if (opts.timeout) req.timeout(opts.timeout);
	if (opts.query) req.query(opts.query);
	if (opts.data) req.body(opts.data);
	if (opts.form) req.body(opts.form, 'form');
	if (opts.compression) req.compress(opts.compression);
	if (opts.maxBuffer) req.resOption('maxBuffer', opts.maxBuffer);
	if ("http2" in opts) req.configure('http2', !!opts.http2);
	if (!opts.redirected) opts.redirected = 0;

	if (typeof opts.core === 'object') {
		Object.keys(opts.core).forEach(optName=>{
			req.option(optName, opts.core[optName]);
		});
	};

	const res = await req.send();

	// follow redirects
	if ("location" in res.headers && opts.followRedirects) {

		// limit the number of redirects
		if (opts.maxRedirects && ++opts.redirected > opts.maxRedirects) return reject(new Error("Exceeded the maximum number of redirects"));

		opts.url = (new URL(res.headers['location'], opts.url)).toString();
		return await phn(opts);
	};

	if (opts.stream) return res;

	res.coreRes.body = res.body;

	switch (opts.parse) {
		case "json":
			res.coreRes.body = await res.json();
		break;
		case "string":
			res.coreRes.body = res.coreRes.body.toString();
		break;
	};

	return res.coreRes;

};

// compat
phn.promisified = phn;
phn.unpromisified = phn;

// defaults
phn.defaults = (defaultOpts)=>async (opts)=>{
	if (typeof opts === 'string') opts = { url: opts };

	Object.keys(defaultOpts).forEach((doK)=>{
		if (!(doK in opts) || opts[doK] === null) {
			opts[doK] = defaultOpts[doK];
		};
	});

	return await phn(opts);
};

module.exports = phn;
