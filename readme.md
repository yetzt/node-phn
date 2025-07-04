# phn

A lightweight HTTP client that works seamlessly with `node` and `bun`:

* http2 support with per-origin session
* http1 keepalive-agent by default
* compression support with fallback zstd support via [fzstd](https://www.npmjs.com/package/fzstd) when installed
* optional decode support via [iconv-lite](https://www.npmjs.com/package/iconv-lite) when installed
* works with async/await, promises and callbacks
* tiny and comes with no required dependencies
* 200% test coverage (we run every test at least twice for good measure)

phn is an interface-compatible, drop-in replacement for the abandoned [phin](https://npmjs.com/package/phin)

## install

> `npm i phn`

## usage

``` js
const phn = require("phn");

const res = await phn({
	url: 'https://example.org'
});
```

### options

* `method` - string; default: `GET`
* `url` - string or URL object
* `core` - object; passed on to `http(s).request`
* `http2` - object; passed on to `http2.request`; `false` to disable http2 support
* `headers` - object; request headers
* `query` - object; added to `url` as query string
* `data` - object, buffer, typed array; sent as data in POST request
* `form` - object; sent as `application/x-www-form-urlencoded`
* `parse` - `"json"`, `"string"`, or `function(body)`; parse response body
* `follow` - follow redirects if `true`, limit if Number (default: 20)
* `stream` - return stream as `res.stream` instead of `res.body`
* `compression` - bool or string, string overrides `accept-encoding` header, default: `true`
* `decode` - bool or string; use `iconv-lite` to decode stream if available
* `timeout` - request timeout in milliseconds
* `maxBuffer` - maximum response buffer size

### stream

consume http response as stream

``` js
const phn = require("phn");

const resp = await phn({
	url: 'https://example.org/',
	compression: true,
	stream: true,
});

resp.stream.pipe(/* ... */)
```

### custom http(s) options

use a custom agent for http and https

``` js
const phn = require("phn");
const https = require("https");

const agent = new SocksProxyAgent(/* ... */);

await phn({
	url: 'https://example.org/',
	core: { agent },
	http2: false
});
```

### unpromisified

builtin classic callback interface

``` js
const phn = require("phn");

phn('https://example.org/', (err, res) => {
	if (!err) console.log(res.body);
});
```

### defaults

set options for any subsequent request

``` js
const phn = require("phn").defaults({
	method: 'POST',
	parse: 'json',
	timeout: 2000
});

const res = await phn('https://example.org/');
```

### `zstd` support

`bun` and `node <=22` don't support `zstd` compression, but `phn` can handle `zstd` when `fzstd` is available

> `npm i fzstd`

### decode support

`phn` can decode various character encodings via the `decode` option when `iconv-lite` is installed

> `npm i iconv-lite`

## license

[MIT](./license.md)

## acknowledgements

`phn` has evolved from a fork of [phin](https://npmjs.com/package/phin) and [centra](https://npmjs.com/package/centra) by [Ethan Davis](https://etdavis.com/)
