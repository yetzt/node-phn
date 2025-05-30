const p = require(`./phn.js`)
const http = require(`http`);
const qs = require(`querystring`);

const tests = [];
tests.add = (name, test) => tests.push([name, test]);

let fail = false;

const run = (i = 0) => {
	const [name, test] = tests[i];
	i++;
	const assert = (pass, message) => {
		console.log(`${i} ${pass ? `\x1b[32mOK\x1b[0m` : `\x1b[31mFAIL\x1b[0m`} ${name}`);
		if(!pass) {
			fail = true;
			console.error(message);
		}
		if(i < tests.length) {
			run(i);
		} else {
			process.exit(fail ? 1 : 0);
		}
	};
	if(test?.then) {
		test(assert).catch(err => {
			fail = true;
			console.error(`\x1b[33m > ERROR\x1b[0m ${name}`, err);
		});
	} else {
		test(assert);
	}
};

// interface

tests.add(`missing options`, assert => {
	try {
		p().then(res=>assert(false)).catch(err=>assert(true, `error received`));
	} catch (err) {
		assert(false);
	}
});

tests.add(`callback interface`, assert => {
	const timer = setTimeout(()=>{ assert(false, `no response`); },1000);
	p(`http://localhost:5136/get`, (err, res) => {
		clearTimeout(timer);
		if (err) return assert(false, err);
		assert(res.statusCode === 200 && res.body.toString() === `Hi`, `unexpected result`);
	});
});

tests.add(`promise interface`, assert => {
	const timer = setTimeout(()=>{ assert(false, `no response`); },1000);
	p(`http://localhost:5136/get`).then(res=>{
		assert(res.statusCode === 200 && res.body.toString() === `Hi`, `unexpected result`);
	}).catch(err=>assert(false, err)).finally(()=>clearTimeout(timer));
});

tests.add(`async interface`, async assert => {
	const timer = setTimeout(()=>{ assert(false, `no response`); },1000);
	try {
		const res = await p(`http://localhost:5136/get`);
		assert(res.statusCode === 200 && res.body.toString() === `Hi`, `unexpected result`);
	} catch (err) {
		assert(false, err);
	};
	clearTimeout(timer);
});

tests.add(`send only`, assert => {
	try {
		p({
			url: `http://localhost:5136/get`,
			method: `GET`,
			stream: true,
			timeout: 1000
		});
		assert(true);
	} catch (err) {
		assert(false, err);
	}
});

// defaults interface

tests.add(`defaults`, assert => {
	p.defaults({ method: `POST` })(`http://localhost:5136/post`).then(res=>assert(res.req.method === `POST`, `defaults not applied`)).catch(err=>assert(false, err));
});

tests.add(`defaults with just URL`, async assert => {
	const ppost = p.defaults({
		method: `POST`
	});
	const res = await ppost(`http://localhost:5136/simplepost`);
	assert(res.statusCode === 200 && res.body.toString() === `Got your POST`, res.statusCode);
});

tests.add(`defaults with object options`, async assert => {
	const ppost = p.defaults({
		method: `POST`
	});
	const res = await ppost({
		url: `http://localhost:5136/simplepost`
	});
	assert(res.statusCode === 200 && res.body.toString() === `Got your POST`, res.statusCode);
});

tests.add(`ensure per-request options don't persist within defaults`, async assert => {
	const def = p.defaults({
		url: `http://localhost:5136/get`,
		timeout: 1000
	});
	const r1 = await def({
		url: `http://localhost:5136/notjson`
	});
	const r2 = await def({});
	assert(r1.body.toString() === `hey` && r2.body.toString() === `Hi`, `${r1.body} ${r2.body}`);
});

// sending data

tests.add(`POST request with body`, assert => {
	p({
		url: `http://localhost:5136/post`,
		method: `POST`,
		data: `Hey there!`
	}, (err, res) => {
		if(err) return assert(false, err);
		assert(res.statusCode === 200 && res.body.toString() === `Looks good`, `unexpected result, status code: ${res.statusCode}`);
	});
});

tests.add(`POST request with form option`, assert => {
	p({
		url: `http://localhost:5136/fd`,
		method: `POST`,
		form: {
			hey: `Hi`
		}
	}, (err, res) => {
		if(err) return assert(false, err);
		assert(res.statusCode === 200, res.body.toString());
	});
});

tests.add(`POST request with data option`, assert => {
	p({
		url: `http://localhost:5136/json`,
		method: `POST`,
		timeout: 500,
		data: {
			hi: `hey`
		}
	}, (err, res) => {
		assert(res.statusCode === 200, res.body.toString());
	});
});

// streams

tests.add(`stream data`, assert => {
	p({
		url: `http://localhost:5136/chunked`,
		method: `GET`,
		stream: true,
		timeout: 500,
	}, (err, res) => {
		if (err) return assert(false, err);
		if (res?.stream) {
			let done = false;
			res.stream.on(`data`, data => {
				if (!done) assert(data.toString() === `hi`, `stream got unexpected partial data`);
				done = true;
			});
		} else {
			assert(false, `Stream property didn't exist`);
		}
	});
});

tests.add(`stream data, no content-length`, assert => {
	p({
		url: `http://localhost:5136/chunked`,
		method: `GET`,
		stream: true,
		timeout: 1000,
	}, (err, res) => {
		assert(!err && res.stream.readable, `stream should be readable even with no content-length`);
	});
});

tests.add(`stream data exceeding maximum Buffer `, assert => {
	p({
		url: `http://localhost:5136/large`,
		method: `GET`,
		timeout: 500,
		maxBuffer: 5e2
	}, (err, res) => {
		assert(err && /longer than acceptable|exceeds maxBuffer/.test(err.message), `request exceeding maximum buffer size was not aborted`);
	});
});

tests.add(`buffer body`, async assert => {
	const res = await p({
		method: `POST`,
		url: `http://localhost:5136/post`,
		data: Buffer.from(`Hey there!`)
	});
	assert(res.statusCode === 200, res.body.toString());
});

// parsing

tests.add(`parse JSON`, assert => {
	p({
		url: `http://localhost:5136/json`,
		method: `GET`,
		timeout: 500,
		parse: `json`
	}, (err, res) => {
		assert(!err && typeof res.body === `object` && res.body.hi === `hey`, `failed to parse json`);
	});
});

tests.add(`parse string`, assert => {
	p({
		url: `http://localhost:5136/get`,
		method: `GET`,
		parse: `string`
	}, (err, res) => {
		assert(!err && res.body === `Hi`, `failed to parse string`);
	});
});

tests.add(`parse "none" returns Buffer`, assert => {
	p({
		url: `http://localhost:5136/get`,
		method: `GET`,
		parse: `none`
	}, (err, res) => {
		assert(!err && Buffer.from(`Hi`).equals(res.body), `failed to return Buffer`);
	});
});

tests.add(`default no parse returns Buffer`, assert => {
	p({
		url: `http://localhost:5136/get`,
		method: `GET`
	}, (err, res) => {
		assert(!err && Buffer.from(`Hi`).equals(res.body), `failed to return Buffer`);
	});
});

tests.add(`parse invalid JSON`, assert => {
	p({
		url: `http://localhost:5136/notjson`,
		method: `GET`,
		timeout: 500,
		parse: `json`
	}, (err) => {
		assert(err, `no error on invalid JSON`);
	});
});

tests.add(`parse empty JSON`, assert => {
	p({
		url: `http://localhost:5136/emptyresponse`,
		method: `POST`,
		timeout: 500,
		data: {
			hi: `hey`
		},
		parse: `json`
	}, (err, res) => {
		assert(res.body === null, `failed to parse empty JSON response`);
	});
});

// http1 specific

tests.add(`HTTP1 core options`, async assert => {
	const res = await p({
		url: `http://localhost:5136/ContentTypeJSON`,
		data: { hey: `hi` },
		core: { method: `POST` }
	});
	assert(res.statusCode === 200, res.body.toString());
});

// default agent
tests.add(`default HTTP agent`, assert => {
	p({
		url: `http://localhost:5136/get`,
		http2: false
	}, (err, res) => {
		if (err) return assert(false, err);
		assert(res?.req?.agent?.options?.keepAlive, `not used`);
	});
});

// custom agent
tests.add(`custom HTTP agent`, assert => {
	p({
		url: `http://localhost:5136/get`,
		http2: false,
		core: { agent: new http.Agent({ foo: `bar` }) },
	}, (err, res) => {
		if (err) return assert(false, err);
		assert((res?.req?.agent?.options?.foo === `bar`), `not used`);
	});
});

// http2
tests.add(`HTTP2 basic GET request`, async assert => {

	const res = await p({
		url: `https://nghttp2.org/httpbin/get`, // publicly available http2 test endpoint
		http2: true,
		timeout: 3000,
		parse: `json`
	});
	assert(res.statusCode === 200 && res.body.url === `https://nghttp2.org/httpbin/get`, `failed http2 GET request`);
});

tests.add(`HTTP2 post with JSON body`, async assert => {
	const res = await p({
		url: `https://nghttp2.org/httpbin/post`,
		method: `POST`,
		http2: true,
		data: { test: true },
		timeout: 3000,
		parse: `json`
	});
	assert(res.statusCode === 200 && res.body.json.test === true, `failed http2 POST with JSON body`);
});

tests.add(`HTTP2 requested but not supported by server`, async assert => {
	try {
		const res = await p({
			url: `http://localhost:5136/get`,
			http2: true,
			timeout: 1000
		});
		assert(res.transport === `http`, `Should have fallen back or failed`);
	} catch (err) {
		assert(/Bad URL protocol|fallback/i.test(err.message), `did not handle lack of http2 correctly`);
	}
});

tests.add(`HTTP2 disabled in client`, async assert => {
	const res = await p({
		url: `https://nghttp2.org/httpbin/get`,
		http2: false,
		timeout: 3000,
		parse: `json`
	});
	assert(res.transport !== `http2`, `should not have used http2`);
});

tests.add(`HTTP2 connection reuse`, async assert => {
	const opts = {
		url: `https://nghttp2.org/httpbin/get`,
		http2: true,
		timeout: 3000,
		parse: `json`
	};
	const res1 = await p(opts);
	const res2 = await p(opts);
	assert(res1.statusCode === 200 && res2.statusCode === 200, `did not reuse http2 session`);
});

// connection handling

tests.add(`timeout option`, assert => {
	p({
		url: `http://localhost:5136/slowres`,
		method: `GET`,
		timeout: 100,
		http2: false,
	}, (err) => {
		assert(err && /timeout/gi.test(err.toString()), `request didn't time out properly`);
	});
});

tests.add(`server abort`, assert => {
	p({
		url: `http://localhost:5136/abort`,
		method: `GET`,
		timeout: 100,
		http2: false,
	}, (err) => {
		assert((err && err.code === "ECONNRESET"), `server abort was not handled`);
	});
});

// decompression

tests.add(`compression`, assert => {
	p({
		url: `http://localhost:5136/compressed`,
		method: `GET`,
		timeout: 1000,
		compression: true
	}, (err, res) => {
		assert(res.body.toString() === `Hello there`, res.body.toString());
	});
});

tests.add(`zstd compression if available`, assert => {
	p({
		url: `http://localhost:5136/compressed-zstd`,
		method: `GET`,
		timeout: 1000,
		compression: true
	}, (err, res) => {
		if (err) return assert(/createZstdDecompress is not a function/.test(err.toString()), err.toString())
		assert(res.body.toString() === `example`, `incorrect decompression`);
	});
});

// decode (if iconv-lite is available)

tests.add(`decode with server charset`, assert => {
	p({
		url: `http://localhost:5136/latin1`,
		decode: true,
	}, (err, res) => {
		if (err) return assert(false, err);
		assert(res.statusCode === 200 && res.body.toString() === `ÄÖÜ`, `decoding failed`);
	});
});

tests.add(`decode with client specified charset`, assert => {
	p({
		url: `http://localhost:5136/koi8u`,
		decode: `koi8-u`,
	}, (err, res) => {
		if (err) return assert(false, err);
		assert(res.statusCode === 200 && res.body.toString() === `ЇЄҐ`, `decoding failed`);
	});
});

tests.add(`no need to decode`, assert => {
	p({
		url: `http://localhost:5136/unicode`,
		decode: true,
	}, (err, res) => {
		if (err) return assert(false, err);
		assert(res.statusCode === 200 && res.body.toString() === `ϋՈįϾ૦ԃễ`, `messed up something that didn't need decoding`);
	});
});

// redirects

tests.add(`follow redirect`, assert => {
	p({
		url: `http://localhost:5136/redirect`,
		method: `GET`,
		timeout: 1000,
		followRedirects: true
	}, (err, res) => {
		assert(res.statusCode === 200 && res.body.toString() === `That's better`, `redirects not followed`);
	});
});

tests.add(`cookie on redirect`, assert => {
	p({
		url: `http://localhost:5136/cookie-redirect`,
		method: `GET`,
		follow: true,
	}, (err, res) => {
		assert(!err && (res.body.toString() === `example-cookie`), `received cookie should be sent to same origin`);
	});
});

tests.add(`redirect loop`, assert => {
	p({
		url: `http://localhost:5136/redirect-loop`,
		method: `GET`,
		follow: true,
		maxRedirects: 1,
	}, (err, res) => {
		assert(err && /exceeded the maximum number of redirects/gi.test(err.toString()), `redirect loop should break`);
	});
});

tests.add(`strip secrets on cross site redirect`, assert => {
	p({
		url: `http://localhost:5136/evil-redirect`,
		method: `GET`,
		follow: true,
		maxRedirects: 1,
		headers: {
			authorization: `secret`,
			public: `public`
		}
	}, (err, res) => {
		assert(!err && !/secret/gi.test(res.body.toString()) && /public/gi.test(res.body.toString()), `suthorization header should be removed`);
	});
});

// http server
const httpServer = http.createServer((req, res) => {
	const routeHandler = {
		GET: {
			"/get": () => {
				res.writeHead(200);
				res.end(`Hi`);
			},
			"/slowres": () => {
				setTimeout(() => {
					res.writeHead(200);
					res.end(`That was slow`);
				}, 1300);
			},
			"/abort": () => {
				req.destroy();
			},
			"/notjson": () => {
				res.writeHead(200);
				res.end(`hey`);
			},
			"/chunked": () => {
				res.chunkedEncoding = true;
				res.writeHead(200);
				res.write(`hi`);
				setTimeout(() => {
					res.end(`hey`);
				}, 50);
			},
			"/json": () => {
				res.writeHead(200);
				res.end(JSON.stringify({
					hi: `hey`
				}));
			},
			"/corrected": () => {
				res.writeHead(200);
				res.end(`That's better`);
			},
			"/redirect2": () => {
				res.writeHead(301, {
					Location: `/corrected`
				});
				res.end();
			},
			"/redirect": () => {
				res.writeHead(301, {
					Location: `/redirect2`
				});
				res.end();
			},
			"/compressed": () => {
				res.writeHead(200, {
					"Content-Encoding": `gzip`
				});
				res.end(Buffer.from(`H4sIALHNB2cAA/NIzcnJVyjJSC1KBQCHZo7rCwAAAA==`, `base64`));
			},
			"/compressed-zstd": () => {
				res.writeHead(200, {
					"Content-Encoding": `zstd`
				});
				res.end(Buffer.from(`KLUv/SQHOQAAZXhhbXBsZV4cxFg=`, `base64`));
			},
			"/latin1": () => {
				res.writeHead(200, {
					"Content-Type": `text/plain; charset=iso-8859-1`
				});
				res.end(Buffer.from([0xC4,0xD6,0xDC])); // ÄÖÜ
			},
			"/koi8u": () => {
				res.writeHead(200, {
					"Content-Type": `text/plain`
				});
				res.end(Buffer.from([0xB7,0xB4,0xBD])); // ЇЄҐ
			},
			"/unicode": () => {
				res.writeHead(200, {
					"Content-Type": `text/plain`
				});
				res.end(`ϋՈįϾ૦ԃễ`);
			},
			"/large": () => {
				res.writeHead(200, {
					"Content-Length": 5e4
				});
				res.end(Buffer.alloc(5e4));
			},
			"/redirect-loop": () => {
				res.writeHead(200, {
					"Location": `/redirect-loop`
				});
				res.end(`move along`);
			},
			"/cookie-redirect": () => {
				res.writeHead(200, {
					"Set-Cookie": `example-cookie`,
					"Location": `/cookie-destination`
				});
				res.end(`move along`);
			},
			"/cookie-destination": () => {
				res.writeHead(200, {});
				res.end(req.headers.cookie);
			},
			"/evil-redirect": () => {
				res.writeHead(200, {
					"Location": `http://127.0.0.1:5136/evil-destination`
				});
				res.end(`move along`);
			},
			"/evil-destination": () => {
				res.writeHead(200, {});
				res.end(req.headers.authorization+req.headers.public);
			},
		},
		POST: {
			"/post": () => {
				let postbody = ``;
				req.on(`data`, ch => postbody += ch);
				req.on(`end`, () => {
					if(postbody === `Hey there!`) {
						res.writeHead(200);
						res.end(`Looks good`);
					} else {
						res.writeHead(400);
						res.end(`Client didn't send expected data`);
					}
				});
			},
			"/emptyresponse": () => {
				res.writeHead(204); // No content
				res.end();
			},
			"/ContentTypeJSON": () => {
				let postbody = ``;
				req.on(`data`, ch => postbody += ch);
				req.on(`end`, () => {
					if(req.headers[`content-type`] === `application/json`) {
						res.writeHead(200);
						res.end(`OK`);
					} else {
						res.writeHead(400);
						res.end(`Bad header`);
					}
				});
			},
			"/fd": () => {
				let postbody = ``;
				req.on(`data`, ch => postbody += ch);
				req.on(`end`, () => {
					try {
						if(qs.parse(postbody).hey === `Hi` && Buffer.byteLength(postbody) === Number(req.headers[`content-length`]) && req.headers[`content-type`] === `application/x-www-form-urlencoded`) {
							res.writeHead(200);
							res.end(`Received valid data`);
						} else {
							res.writeHead(400);
							res.end(`Invalid form data or headers`);
						}
					} catch (err) {
						res.writeHead(400);
						res.end(`Parsing failed: ` + err);
					}
				});
			},
			"/json": () => {
				let postbody = ``;
				req.on(`data`, ch => postbody += ch);
				req.on(`end`, () => {
					try {
						const jsonParsed = JSON.parse(postbody);
						if(jsonParsed.hi === `hey`) {
							res.writeHead(200);
							res.end(`Good`);
						} else {
							res.writeHead(400);
							res.end(`Bad data`);
						}
					} catch (err) {
						res.writeHead(400);
						res.end(`Not JSON`);
					}
				});
			},
			"/simplepost": () => {
				res.writeHead(200);
				res.end(`Got your POST`);
			}
		}
	};
	const handler = routeHandler[req.method]?.[req.url] || (() => {
		res.writeHead(404);
		res.end(`Not a valid test endpoint`);
	});
	handler();
}).listen(5136, () => run());