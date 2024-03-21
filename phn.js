const path = require('path');
const http = require('http');
const https = require('https');
const qs = require('querystring');
const zlib = require('zlib');
const { URL } = require('url');

const supportedCompressions = 'br, gzip, deflate';

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

	constructor (url, method = 'GET') {
		this.url = (typeof url === 'string') ? new URL(url) : url;
		this.method = method;
		this.data = null;
		this.sendDataAs = null;
		this.reqHeaders = {};
		this.streamEnabled = false;
		this.compressionEnabled = false;
		this.timeoutTime = null;
		this.coreOptions = {};
		this.resOptions = { maxBuffer: 5e7 };;
		return this;
	};

	query (key, value) {
		if (typeof key === 'object') Object.entries(key).forEach(([queryKey, queryValue])=>{
			this.url.searchParams.append(queryKey, queryValue);
		});
		else this.url.searchParams.append(key, value);
		return this;
	};

	path (relativePath) {
		this.url.pathname = path.join(this.url.pathname, relativePath);
		return this;
	};

	body (data, sendAs) {
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

	header (key, value) {
		if (typeof key === 'object') Object.entries(key).forEach(([queryKey, queryValue]) => {
			this.url.searchParams.append(queryKey, queryValue);
		}); else this.url.searchParams.append(key, value);
		return this;
	};

	header (key, value) {
		if (typeof key === 'object') Object.entries(key).forEach(([headerName, headerValue]) => {
			this.reqHeaders[headerName.toLowerCase()] = headerValue;
		}); else this.reqHeaders[key.toLowerCase()] = value;
		return this;
	};

	timeout (timeout) {
		this.timeoutTime = timeout;
		return this;
	};

	option (name, value) {
		this.coreOptions[name] = value;
		return this;
	};

	stream () {
		this.streamEnabled = true;
		return this;
	};

	compress () {
		this.compressionEnabled = true;
		if (!this.reqHeaders['accept-encoding']) this.reqHeaders['accept-encoding'] = supportedCompressions;
		return this;
	};

	send () {
		return new Promise((resolve, reject) => {
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

			const resHandler = (res) => {
				let stream = res;

				if (this.compressionEnabled) {
					switch (res.headers['content-encoding']) {
						case "br":
							stream = res.pipe(zlib.createBrotliDecompress());
						break;
						case "gzip":
							stream = res.pipe(zlib.createGunzip());
						break;
						case "deflate":
							stream = res.pipe(zlib.createInflate());
						break;
					};
				};

				if (this.streamEnabled) {
					res.stream = stream;
					return resolve(res);
				};

				let resp = new response(res, this.resOptions);

				stream.on('error', err => {
					reject(err);
				});

				stream.on('aborted', () => {
					reject(new Error('Server aborted request'));
				});

				stream.on('data', chunk => {
					resp._addChunk(chunk);

					if (this.resOptions.maxBuffer !== null && resp.body.length > this.resOptions.maxBuffer) {
						stream.destroy();
						reject(new Error('Received a response which was longer than acceptable when buffering. (' + resp.body.length + ' bytes)'));
					};
				});

				stream.on('end', () => {
					resolve(resp);
				});

			};

			switch (this.url.protocol) {
				case 'https:':
					req = https.request(options, resHandler);
				break;
				case 'http:':
					req = http.request(options, resHandler);
				break;
				default:
					reject(new Error('Bad URL protocol: ' + this.url.protocol));
				break;
			};

			if (this.timeoutTime) req.setTimeout(this.timeoutTime, () => {
				req.abort();
				if (!this.streamEnabled) reject(new Error('Timeout reached'));
			});

			req.on('error', (err) => {
				reject(err);
			});

			if (this.data) req.write(this.data);

			req.end();
		});
	};
};

/**
* phn options object. phn also supports all options from <a href="https://nodejs.org/api/http.html#http_http_request_options_callback">http.request(options, callback)</a> by passing them on to this method (or similar).
* @typedef {Object} phnOptions
* @property {string} url - URL to request (autodetect infers from this URL)
* @property {string} [method=GET] - Request method ('GET', 'POST', etc.)
* @property {Object} [query] - Object to be added as a query string to the URL
* @property {string|Buffer|object} [data] - Data to send as request body (phn may attempt to convert this data to a string if it isn't already)
* @property {Object} [form] - Object to send as form data (sets 'Content-Type' and 'Content-Length' headers, as well as request body) (overwrites 'data' option if present)
* @property {Object} [headers={}] - Request headers
* @property {Object} [core={}] - Custom core HTTP options
* @property {string} [parse=none] - Response parsing. Errors will be given if the response can't be parsed. 'none' returns body as a `Buffer`, 'json' attempts to parse the body as JSON, and 'string' attempts to parse the body as a string
* @property {boolean} [followRedirects=false] - Enable HTTP redirect following
* @property {Number} [maxRedirects=0] - Maximum number of redirects to follow. (0 = Infinite)
* @property {boolean} [stream=false] - Enable streaming of response. (Removes body property)
* @property {boolean} [compression=false] - Enable compression for request
* @property {?number} [timeout=null] - Request timeout in milliseconds
* @property {string} [hostname=autodetect] - URL hostname
* @property {Number} [port=autodetect] - URL port
* @property {string} [path=autodetect] - URL path
*/

/**
* Response data
* @callback phnResponseCallback
* @param {?(Error|string)} error - Error if any occurred in request, otherwise null.
* @param {?http.serverResponse} phnResponse - phn response object. Like <a href='https://nodejs.org/api/http.html#http_class_http_serverresponse'>http.ServerResponse</a> but has a body property containing response body, unless stream. If stream option is enabled, a stream property will be provided to callback with a readable stream.
*/

/**
* Sends an HTTP request
* @param {phnOptions|string} options - phn options object (or string for auto-detection)
* @returns {Promise<http.serverResponse>} - phn-adapted response object
*/
const phn = async (opts) => {
	if (typeof(opts) === 'string') opts = { url: opts };
	if (!opts.hasOwnProperty('url') || !opts.url) throw new Error('Missing url option from options for request method.')

	const req = new request(opts.url, opts.method || 'GET');

	if (opts.headers) req.header(opts.headers);
	if (opts.stream) req.stream();
	if (opts.timeout) req.timeout(opts.timeout);
	if (opts.query) req.query(opts.query);
	if (opts.data) req.body(opts.data);
	if (opts.form) req.body(opts.form, 'form');
	if (opts.compression) req.compress();
	if (!opts.redirected) opts.redirected = 0;

	if (typeof opts.core === 'object') {
		Object.keys(opts.core).forEach((optName) => {
			req.option(optName, opts.core[optName]);
		});
	};

	const res = await req.send();

	// follow redirects
	if (res.headers.hasOwnProperty('location') && opts.followRedirects) {

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

// callback interface
phn.unpromisified = (opts, fn) => {
	phn(opts).then(data=>{
		if (fn) fn(null, data);
	}).catch(err=>{
		if (fn) fn(err, null);
	});
};

// defaults
phn.defaults = (defaultOpts) => async (opts) => {
	if (typeof(opts) === 'string') opts = { url: opts };

	Object.keys(defaultOpts).forEach((doK) => {
		if (!opts.hasOwnProperty(doK) || opts[doK] === null) {
			opts[doK] = defaultOpts[doK];
		};
	});

	return await phn(opts);
};

module.exports = phn;
