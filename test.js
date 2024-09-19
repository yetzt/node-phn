const { test } = require('uvu');
const assert = require('uvu/assert');

/*
test('hello', () => {
  assert.is(false, true, 'yay');
});

test('yay', () => {
  assert.is(false, false, '3 should be odd');
});
*/

const p = require('./phn.js').unpromisified
const pp = require('./phn.js')

const http = require('http')
const zlib = require('zlib')
const qs = require('querystring')

let httpHandler = (req, res) => {
	switch (req.method) {
		case 'GET':
			switch (req.url) {
				case '/testget':
					res.writeHead(200)
					res.end('Hi.')
					break
				case '/slowres':
					setTimeout(() => {
						res.writeHead(200)
						res.end('That was slow.')
					}, 1300);
					break
				case '/notjson':
					res.writeHead(200)
					res.end('hey')
					break
				case '/chunked':
						res.writeHead(200)
						res.write('hi')
						setTimeout(() => {
							res.end('hey')
						}, 50)
					break
				case '/json':
					res.writeHead(200)
					res.end(JSON.stringify({
						'hi': 'hey'
					}))
					break
				case '/corrected':
					res.writeHead(200)
					res.end('That\'s better.')
					break
				case '/redirect2':
					res.writeHead(301, {
						'Location': '/corrected'
					})
					res.end()
					break;
				case '/redirect':
					res.writeHead(301, {
						'Location': '/redirect2'
					})
					res.end()
					break
				case '/compressed':
					res.writeHead(200, {
						'Content-Encoding': 'gzip'
					})

					const compressor = zlib.createGzip()

					compressor.pipe(res)

					compressor.write('Hello there')
					compressor.end()
					break
				case '/large':
					res.writeHead(200, {
						'Content-Length': 5e4
					})
					res.end(Buffer.alloc(5e4))
					break
				default:
					res.writeHead(404)
					res.end('Not a valid test endpoint')
					break
			}
			break
		case 'POST':
			let postbody = ''

			req.on('data', (ch) => {
				postbody += ch
			})

			req.on('end', () => {
				switch (req.url) {
					case '/testpost':
						if (postbody === 'Hey there!') {
							res.writeHead(200)
							res.end('Looks good.')
						}
						else {
							res.writeHead(400)
							res.end('Client didn\'t send expected data.')
						}
						break
					case '/testemptyresponse':
						res.writeHead(204)
						res.end()
						return
					case '/testContentTypeJSON':
						if (req.headers['content-type'] === 'application/json') {
							res.writeHead(200)
							res.end('OK')
						}
						else {
							res.writeHead(400)
							res.end('Bad header')
						}

						break
					case '/testfd':
						try {
							if (qs.parse(postbody).hey === 'Hi') {
								if (Buffer.byteLength(postbody) === Number(req.headers['content-length'])) {
									if (req.headers['content-type'].toString() === 'application/x-www-form-urlencoded') {
										res.writeHead(200)
										res.end('Recieved valid data.')
									}
									else {
										res.writeHead(400)
										res.end('Incorrect content-type recieved by server.')
									}
								}
								else {
									res.writeHead(400)
									res.end('Content-Length header contained incorrect content length.')
								}
							}
							else {
								res.writeHead(400)
								res.end('Couldn\'t find a required property in data.')
							}
						}
						catch (err) {
							res.writeHead(400)
							res.end('Parsing as query string failed. ' + err)
							break
						}
						break
					case '/testjson':
						try {
							let jsonParsed = JSON.parse(postbody)

							if (jsonParsed.hi === 'hey') {
								res.writeHead(200)
								res.end('Good.')
							}
							else {
								res.writeHead(400)
								res.end('Bad data.')
							}
						}
						catch (err) {
							res.writeHead(400)
							res.end('Not JSON.')
							return
						}
						break
					case '/simplepost':
						res.writeHead(200)
						res.end('Got your POST.')
						break
					default:
						res.writeHead(404)
						res.end('Not a valid POST test endpoint')
						break
				}
			})
			break
		default:
			res.writeHead(405)
			res.end('Invalid request method')
			break
	}
}

test('Simple GET request', () => {
	p('http://localhost:5136/testget', (err, res) => {
		if (err) {
			assert.ok(false, err)
			return
		}
		if (res.statusCode === 200 && res.body.toString() === 'Hi.') {
			assert.ok(true, 'Recieved expected body and status code.')
		}
		else {
			assert.ok(false, 'Recieved unexpected data. Status code: ' + res.statusCode)
		}
	})
})

test('POST request with body', () => {
	p({
		'url': 'http://localhost:5136/testpost',
		'method': 'POST',
		'data': 'Hey there!'
	}, (err, res) => {
		if (err) {
			assert.ok(false, err)
			return
		}
		if (res.statusCode === 200 && res.body.toString() === 'Looks good.') {
			assert.ok(true, 'Client sent expected data, recieved by endpoint.')
		}
		else {
			assert.ok(false, 'Recieved unexpected data. Status code: ' + res.statusCode)
		}
	})
})

test('Promisified phin requesting', () => {
	pp({
		'url': 'http://localhost:5136/testget',
		'method': 'GET'
	}).then((res) => {
		if (res.body.toString() === 'Hi.') {
			assert.ok(true, 'Promisified phin requested properly.')
		}
		else {
			assert.ok(false, 'Promisified phin did not properly send data to handler.')
		}
	}).catch((err) => {
		assert.ok(false, err)
	})
})

test('Timeout option', () => {
	p({
		'url': 'http://localhost:5136/slowres',
		'method': 'GET',
		'timeout': 500
	}, (err, res) => {
		if (err) {
			if (/timeout/gi.test(err.toString())) {
				assert.ok(true, 'Request timed out properly.')
				return
			}
			else {
				assert.ok(false, 'Non-timeout related error from phin.')
			}
		}
		else {
			assert.ok(false, 'Request didn\'t time out properly.')
		}
	})
})

test('Sending form data with \'form\' option', () => {
	p({
		'url': 'http://localhost:5136/testfd',
		'method': 'POST',
		'form': {
			'hey': 'Hi'
		}
	}, (err, res) => {
		if (err) {
			assert.ok(false, err)
		}
		else {
			if (res.statusCode === 200) {
				assert.ok(true, 'Server recieved valid form data.')
			}
			else {
				assert.ok(false, res.body.toString())
			}
		}
	})
})

test('Parse JSON', () => {
	p({
		'url': 'http://localhost:5136/json',
		'method': 'GET',
		'timeout': 500,
		'parse': 'json'
	}, (err, res) => {
		if (!err && typeof res.body === 'object' && res.body.hi === 'hey') {
			assert.ok(true, 'Parsed JSON properly.')
		}
		else assert.ok(false, 'Failed to parse JSON.')
	})
})

test('Parse string', () => {
	p({
		'url': 'http://localhost:5136/testget',
		'method': 'GET',
		'parse': 'string',
	}, (err, res) => {
		if (!err && typeof res.body === 'string' && res.body === 'Hi.') {
			assert.ok(true, 'Parsed string properly.')
		}
		else assert.ok(false, 'Failed to parse string.')
	})
})

test('Parse "none" returns Buffer', () => {
	p({
		'url': 'http://localhost:5136/testget',
		'method': 'GET',
		'parse': 'none',
	}, (err, res) => {
		if (!err && res.body instanceof Buffer && Buffer.from('Hi.').equals(res.body)) {
			assert.ok(true, 'Buffer returned properly.')
		}
		else assert.ok(false, 'Failed to return Buffer.')
	})
})

test('Default no parse returns Buffer', () => {
	p({
		'url': 'http://localhost:5136/testget',
		'method': 'GET',
	}, (err, res) => {
		if (!err && res.body instanceof Buffer && Buffer.from('Hi.').equals(res.body)) {
			assert.ok(true, 'Buffer returned properly.')
		}
		else assert.ok(false, 'Failed to return Buffer.')
	})
})

test('Send object', () => {
	p({
		'url': 'http://localhost:5136/testjson',
		'method': 'POST',
		'timeout': 500,
		'data': {
			'hi': 'hey'
		}
	}, (err, res) => {
		if (!err) {
			if (res.statusCode === 200) {
				assert.ok(true, 'Server recieved the correct data.')
			}
			else assert.ok(false, res.body.toString())
		}
		else assert.ok(false, err)
	})
})

test('No callback', () => {
	try {
		p({
			'url': 'http://localhost:5136/testget',
			'method': 'GET',
			'stream': true,
			'timeout': 1000
		})
	}
	catch (err) {
		assert.ok(false, err)
		return
	}

	assert.ok(true, 'Success.')
})

test('Parse bad JSON', () => {
	p({
		'url': 'http://localhost:5136/notjson',
		'method': 'GET',
		'timeout': 500,
		'parse': 'json'
	}, (err, res) => {
		if (err) {
			assert.ok(true, 'Gave correct error on invalid JSON.')
		}
		else {
			assert.ok(false, 'Didn\'t give error on invalid JSON.')
		}
	})
})

test('Compression', () => {
	p({
		'url': 'http://localhost:5136/compressed',
		'method': 'GET',
		'timeout': 1000,
		'compression': true
	}, (err, res) => {
		assert.ok(res.body.toString() === 'Hello there', res.body.toString())
	})
})

test('Follow redirect', () => {
	p({
		'url': 'http://localhost:5136/redirect',
		'method': 'GET',
		'timeout': 1000,
		'followRedirects': true
	}, (err, res) => {
		assert.ok(res.statusCode === 200)
	})
})

test('Stream data from server', () => {
	p({
		'url': 'http://localhost:5136/chunked',
		'method': 'GET',
		'stream': true,
		'timeout': 500
	}, (err, res) => {
		if (err) {
			assert.ok(false, err)
		}
		else {
			if (res.hasOwnProperty('stream')) {
				res.stream.once('data', (data) => {
					if (data.toString() === 'hi') {
						assert.ok(true, 'Stream got expected partial data.')
					}
					else {
						assert.ok(false, 'Stream got unexpected partial data.')
					}
				})
			}
			else {
				assert.ok(false, 'Stream property didn\'t exist.')
			}
		}
	})
})

test('Defaults with just URL', async () => {
	const ppost = pp.defaults({
		'method': 'POST'
	})

	const res = await ppost('http://localhost:5136/simplepost')

	assert.ok(res.statusCode === 200 && res.body.toString() === 'Got your POST.', res.statusCode)
})

test('Defaults with object options', async () => {
	const ppost = pp.defaults({
		'method': 'POST'
	})

	const res = await ppost({
		'url': 'http://localhost:5136/simplepost'
	})

	assert.ok(res.statusCode === 200 && res.body.toString() === 'Got your POST.', res.statusCode)
})

test('Buffer body', async () => {
	const res = await pp({
		'method': 'POST',
		'url': 'http://localhost:5136/testpost',
		'data': Buffer.from('Hey there!')
	})

	assert.ok(res.statusCode === 200, res.body.toString())
})

test('JSON body content-type header', async () => {
	const res = await pp({
		'method': 'POST',
		'url': 'http://localhost:5136/testContentTypeJSON',
		'data': {
			'hey': 'hi'
		}
	})

	assert.ok(res.statusCode === 200, res.body.toString())
})

test('Specify core HTTP options', async () => {
	const res = await pp({
		'url': 'http://localhost:5136/testContentTypeJSON',
		'data': {
			'hey': 'hi'
		},
		'core': {
			'method': 'POST'
		}
	})

	assert.ok(res.statusCode === 200, res.body.toString())
})

test('Ensure that per-request options do not persist within defaults', async () => {
	const def = pp.defaults({
		'url': 'http://localhost:5136/testget',
		'timeout': 1000
	})

	const r1 = await def({
		'url': 'http://localhost:5136/notjson'
	})

	const r2 = await def({})

	assert.ok(r1.body.toString() === 'hey' && r2.body.toString() === 'Hi.', r1.body.toString() + ' ' + r2.body.toString())
})

test('Parse empty JSON response', () => {
	p({
		'url': 'http://localhost:5136/testemptyresponse',
		'method': 'POST',
		'timeout': 500,
		'data': {
			'hi': 'hey'
		},
		'parse': 'json'
	}, (err, res) => {
		if (err) {
			return assert.ok(false, err.message)
		}

		// Check that the res.body provided is null
		if (res.body === null) {
			assert.ok(true, 'Parsed null response properly')
		}
		else assert.ok(false, 'Failed to parse empty JSON response')
	})
})

test('Maximum Buffer exceeded', () => {
	p({
		'url': 'http://localhost:5136/large',
		'method': 'GET',
		'timeout': 500,
		'maxBuffer': 5e2,
	}, (err, res) => {
		if (err && err.message === "Server aborted request") {
			return assert.ok(true, 'Request exceeding maximum Buffer size was aborted')
		}
		return assert.ok(false, 'Request exceeding maximum Buffer size was not aborted')
	})
})

let httpServer = http.createServer(httpHandler).listen(5136, async ()=>{
	test.after(() => {
		setTimeout(()=>{
			httpServer.close();
		},0); //
	});
	test.run();
});

