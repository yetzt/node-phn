const p = require('./phn.js').unpromisified
const pp = require('./phn.js')
const http = require('http');
const qs = require('querystring');

const tests = [];
tests.add = (name, test) => tests.push([name, test]);

let fail = false;

const run = (i = 0) => {
	const [name, test] = tests[i];
	i++;
	const assert = (pass, message) => {
		console.log(`${i} ${pass ? "\x1b[32mOK\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${name}`);
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

// defaults
tests.add('Defaults', assert => {
	pp.defaults({ method: 'POST' })('http://localhost:5136/post').then(res=>assert(res.req.method === "POST", `Defaults not applied`)).catch(err=>assert(false, err));
});

// missing opts
tests.add('Missing Options', assert => {
	try {
		pp().then(res=>assert(false, `No Error`)).catch(err=>assert(true, "Error received"));
	} catch (err) {
		assert(false, "Error caught")
	}
});

// Define test cases
tests.add('Callback Interface', assert => {
	p('http://localhost:5136/get', (err, res) => {
		if (err) return assert(false, err);
		assert(res.statusCode === 200 && res.body.toString() === 'Hi.', `Received unexpected data. Status code: ${res.statusCode}`);
	});
});

tests.add('Promise Interface', assert => {
	pp('http://localhost:5136/get').then(res=>{
		assert(res.statusCode === 200 && res.body.toString() === 'Hi.', `Received unexpected data. Status code: ${res.statusCode}`);
	}).catch(err=>assert(false, err));
});

tests.add('async Interface', async assert => {
	try {
		const res = await pp('http://localhost:5136/get');
		assert(res.statusCode === 200 && res.body.toString() === 'Hi.', `Received unexpected data. Status code: ${res.statusCode}`);
	} catch (err) {
		assert(false, err);
	}
});

tests.add('POST request with body', assert => {
	p({
		url: 'http://localhost:5136/post',
		method: 'POST',
		data: 'Hey there!'
	}, (err, res) => {
		if(err) return assert(false, err);
		assert(res.statusCode === 200 && res.body.toString() === 'Looks good.', `Received unexpected data. Status code: ${res.statusCode}`);
	});
});

tests.add('Promisified phin requesting', assert => {
	pp({
		url: 'http://localhost:5136/get',
		method: 'GET'
	}).then(res => assert(res.body.toString() === 'Hi.', 'Promisified phin did not properly send data to handler.')).catch(err => assert(false, err));
});

tests.add('Timeout option', assert => {
	p({
		url: 'http://localhost:5136/slowres',
		method: 'GET',
		timeout: 100,
		http2: false,
	}, (err) => {
		if(err && /timeout/gi.test(err.toString())) {
			return assert(true, 'Request timed out properly.');
		}
		assert(false, 'Request didn\'t time out properly.');
	});
});

tests.add('Sending form data with \'form\' option', assert => {
	p({
		url: 'http://localhost:5136/fd',
		method: 'POST',
		form: {
			hey: 'Hi'
		}
	}, (err, res) => {
		if(err) return assert(false, err);
		assert(res.statusCode === 200, res.body.toString());
	});
});

tests.add('Parse JSON', assert => {
	p({
		url: 'http://localhost:5136/json',
		method: 'GET',
		timeout: 500,
		parse: 'json'
	}, (err, res) => {
		assert(!err && typeof res.body === 'object' && res.body.hi === 'hey', 'Failed to parse JSON.');
	});
});

tests.add('Parse string', assert => {
	p({
		url: 'http://localhost:5136/get',
		method: 'GET',
		parse: 'string'
	}, (err, res) => {
		assert(!err && res.body === 'Hi.', 'Failed to parse string.');
	});
});

tests.add('Parse "none" returns Buffer', assert => {
	p({
		url: 'http://localhost:5136/get',
		method: 'GET',
		parse: 'none'
	}, (err, res) => {
		assert(!err && Buffer.from('Hi.').equals(res.body), 'Failed to return Buffer.');
	});
});

tests.add('Default no parse returns Buffer', assert => {
	p({
		url: 'http://localhost:5136/get',
		method: 'GET'
	}, (err, res) => {
		assert(!err && Buffer.from('Hi.').equals(res.body), 'Failed to return Buffer.');
	});
});

tests.add('Send object', assert => {
	p({
		url: 'http://localhost:5136/json',
		method: 'POST',
		timeout: 500,
		data: {
			hi: 'hey'
		}
	}, (err, res) => {
		assert(res.statusCode === 200, res.body.toString());
	});
});

tests.add('No callback', assert => {
	try {
		p({
			url: 'http://localhost:5136/get',
			method: 'GET',
			stream: true,
			timeout: 1000
		});
		assert(true, 'Success.');
	} catch (err) {
		assert(false, err);
	}
});

tests.add('Parse bad JSON', assert => {
	p({
		url: 'http://localhost:5136/notjson',
		method: 'GET',
		timeout: 500,
		parse: 'json'
	}, (err) => {
		assert(err, 'Didn\'t give error on invalid JSON.');
	});
});

tests.add('Compression', assert => {
	p({
		url: 'http://localhost:5136/compressed',
		method: 'GET',
		timeout: 1000,
		compression: true
	}, (err, res) => {
		assert(res.body.toString() === 'Hello there', res.body.toString());
	});
});

/* if (typeof Bun === "undefined") */ tests.add('Compression zstd', assert => {
	p({
		url: 'http://localhost:5136/compressed-zstd',
		method: 'GET',
		timeout: 1000,
		compression: true
	}, (err, res) => {
		assert(res.body.toString() === 'example', err);
	});
});

tests.add('Follow redirect', assert => {
	p({
		url: 'http://localhost:5136/redirect',
		method: 'GET',
		timeout: 1000,
		followRedirects: true
	}, (err, res) => {
		assert(res.statusCode === 200, 'Redirect followed');
	});
});

tests.add('Stream data from server', assert => {
	p({
		url: 'http://localhost:5136/chunked',
		method: 'GET',
		stream: true,
		timeout: 500,
	}, (err, res) => {
		if (err) return assert(false, err);
		if (res?.stream) {
			let done = false;
			res.stream.on('data', data => {
				if (!done) assert(data.toString() === 'hi', 'Stream got unexpected partial data.');
				done = true;
			});
		} else {
			assert(false, 'Stream property didn\'t exist.');
		}
	});
});

tests.add('Defaults with just URL', async assert => {
	const ppost = pp.defaults({
		method: 'POST'
	});
	const res = await ppost('http://localhost:5136/simplepost');
	assert(res.statusCode === 200 && res.body.toString() === 'Got your POST.', res.statusCode);
});

tests.add('Defaults with object options', async assert => {
	const ppost = pp.defaults({
		method: 'POST'
	});
	const res = await ppost({
		url: 'http://localhost:5136/simplepost'
	});
	assert(res.statusCode === 200 && res.body.toString() === 'Got your POST.', res.statusCode);
});

tests.add('Buffer body', async assert => {
	const res = await pp({
		method: 'POST',
		url: 'http://localhost:5136/post',
		data: Buffer.from('Hey there!')
	});
	assert(res.statusCode === 200, res.body.toString());
});

tests.add('JSON body content-type header', async assert => {
	const res = await pp({
		method: 'POST',
		url: 'http://localhost:5136/ContentTypeJSON',
		data: {
			hey: 'hi'
		}
	});
	assert(res.statusCode === 200, res.body.toString());
});

tests.add('Specify core HTTP options', async assert => {
	const res = await pp({
		url: 'http://localhost:5136/ContentTypeJSON',
		data: {
			hey: 'hi'
		},
		core: {
			method: 'POST'
		}
	});
	assert(res.statusCode === 200, res.body.toString());
});

tests.add('Ensure that per-request options do not persist within defaults', async assert => {
	const def = pp.defaults({
		url: 'http://localhost:5136/get',
		timeout: 1000
	});
	const r1 = await def({
		url: 'http://localhost:5136/notjson'
	});
	const r2 = await def({});
	assert(r1.body.toString() === 'hey' && r2.body.toString() === 'Hi.', `${r1.body} ${r2.body}`);
});

tests.add('Parse empty JSON response', assert => {
	p({
		url: 'http://localhost:5136/emptyresponse',
		method: 'POST',
		timeout: 500,
		data: {
			hi: 'hey'
		},
		parse: 'json'
	}, (err, res) => {
		assert(res.body === null, 'Failed to parse empty JSON response');
	});
});

tests.add('Maximum Buffer exceeded', assert => {
	p({
		url: 'http://localhost:5136/large',
		method: 'GET',
		timeout: 500,
		maxBuffer: 5e2
	}, (err, res) => {
		assert(err && /longer than acceptable|exceeds maxBuffer/.test(err.message), 'Request exceeding maximum Buffer size was not aborted');
	});
});

// HTTP Server
const httpServer = http.createServer((req, res) => {
	const routeHandler = {
		GET: {
			'/get': () => {
				res.writeHead(200);
				res.end('Hi.');
			},
			'/slowres': () => {
				setTimeout(() => {
					res.writeHead(200);
					res.end('That was slow.');
				}, 1300);
			},
			'/notjson': () => {
				res.writeHead(200);
				res.end('hey');
			},
			'/chunked': () => {
				res.chunkedEncoding = true;
				res.writeHead(200);
				res.write('hi');
				setTimeout(() => {
					res.end('hey');
				}, 50);
			},
			'/json': () => {
				res.writeHead(200);
				res.end(JSON.stringify({
					hi: 'hey'
				}));
			},
			'/corrected': () => {
				res.writeHead(200);
				res.end('That\'s better.');
			},
			'/redirect2': () => {
				res.writeHead(301, {
					Location: '/corrected'
				});
				res.end();
			},
			'/redirect': () => {
				res.writeHead(301, {
					Location: '/redirect2'
				});
				res.end();
			},
			'/compressed': () => {
				res.writeHead(200, {
					'Content-Encoding': 'gzip'
				});
				res.end(Buffer.from('H4sIALHNB2cAA/NIzcnJVyjJSC1KBQCHZo7rCwAAAA==', 'base64'));
			},
			'/compressed-zstd': () => {
				res.writeHead(200, {
					'Content-Encoding': 'zstd'
				});
				res.end(Buffer.from('KLUv/SQHOQAAZXhhbXBsZV4cxFg=', 'base64'));
			},
			'/large': () => {
				res.writeHead(200, {
					'Content-Length': 5e4
				});
				res.end(Buffer.alloc(5e4));
			}
		},
		POST: {
			'/post': () => {
				let postbody = '';
				req.on('data', ch => postbody += ch);
				req.on('end', () => {
					if(postbody === 'Hey there!') {
						res.writeHead(200);
						res.end('Looks good.');
					} else {
						res.writeHead(400);
						res.end('Client didn\'t send expected data.');
					}
				});
			},
			'/emptyresponse': () => {
				res.writeHead(204); // No content
				res.end();
			},
			'/ContentTypeJSON': () => {
				let postbody = '';
				req.on('data', ch => postbody += ch);
				req.on('end', () => {
					if(req.headers['content-type'] === 'application/json') {
						res.writeHead(200);
						res.end('OK');
					} else {
						res.writeHead(400);
						res.end('Bad header');
					}
				});
			},
			'/fd': () => {
				let postbody = '';
				req.on('data', ch => postbody += ch);
				req.on('end', () => {
					try {
						if(qs.parse(postbody).hey === 'Hi' && Buffer.byteLength(postbody) === Number(req.headers['content-length']) && req.headers['content-type'] === 'application/x-www-form-urlencoded') {
							res.writeHead(200);
							res.end('Received valid data.');
						} else {
							res.writeHead(400);
							res.end('Invalid form data or headers.');
						}
					} catch (err) {
						res.writeHead(400);
						res.end('Parsing failed: ' + err);
					}
				});
			},
			'/json': () => {
				let postbody = '';
				req.on('data', ch => postbody += ch);
				req.on('end', () => {
					try {
						const jsonParsed = JSON.parse(postbody);
						if(jsonParsed.hi === 'hey') {
							res.writeHead(200);
							res.end('Good.');
						} else {
							res.writeHead(400);
							res.end('Bad data.');
						}
					} catch (err) {
						res.writeHead(400);
						res.end('Not JSON.');
					}
				});
			},
			'/simplepost': () => {
				res.writeHead(200);
				res.end('Got your POST.');
			}
		}
	};
	const handler = routeHandler[req.method]?.[req.url] || (() => {
		res.writeHead(404);
		res.end('Not a valid test endpoint');
	});
	handler();
}).listen(5136, () => run());