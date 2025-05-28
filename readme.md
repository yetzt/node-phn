# phn

a lightweight http client that works great with `node` and `bun`

* http2 support
* works with async/await and callbacks
* compression support
* fallback zstd support via [fzstd](https://www.npmjs.com/package/fzstd) when installed
* 200% test coverage (we run them at least twice)

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
* `url` - string or url object
* `core` - object; passed on to `http(s).request`
* `http2` - object; passed on to `http2.request`; `false` to disable http2 support
* `headers` - object; request headers
* `query` - object; added to `url` as query string
* `data` - object, buffer, typed array; sent as data in POST request
* `form` - object; sent as `application/x-www-form-urlencoded`
* `parse` - `"json"`, `"string"` or `function(body)`; parse response body
* `follow` - follow redirects if `true`
* `maxRedirects` - maximum number of redirects
* `stream` - return stream as `res.stream` instead of `res.body`
* `compression` - bool or string, string overrides `accept-encoding` header, default: `true`
* `timeout` -  request timeout in milliseconds
* `maxBuffer` -  maximum response buffer size

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

use a custom agent

``` js
const phn = require("phn");
const https = require("https");

const agent = new https.Agent({ keepAlive: true });

await phn({
	url: 'https://example.org/',
	core: { agent },
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

const res = await phn('https://example.org/')
```

### `zstd` support

`bun` and `node <=22` don't support `zstd` compression, but `phn` can handle `zstd` when `fzstd` is available.

> `npm i fzstd`

## comparison

`phn` is tiny and comes with no required dependencies

package | size
--- | ---
[phn](https://npmjs.com/package/phn) | [![phn package size](https://packagephobia.now.sh/badge?p=phn)](https://packagephobia.now.sh/result?p=phn)
[needle](https://npmjs.com/package/needle) | [![needle package size](https://packagephobia.now.sh/badge?p=needle)](https://packagephobia.now.sh/result?p=needle)
[got](https://npmjs.com/package/got) | [![got package size](https://packagephobia.now.sh/badge?p=got)](https://packagephobia.now.sh/result?p=got)
[undici](https://npmjs.com/package/undici) | [![undici package size](https://packagephobia.now.sh/badge?p=undici)](https://packagephobia.now.sh/result?p=undici)
[axios](https://npmjs.com/package/axios) | [![axios package size](https://packagephobia.now.sh/badge?p=axios)](https://packagephobia.now.sh/result?p=axios)
[superagent](https://npmjs.com/package/superagent) | [![superagent package size](https://packagephobia.now.sh/badge?p=superagent)](https://packagephobia.now.sh/result?p=superagent)

## license

[MIT](./license.md)

## acknowledgement

`phn` has evolved from a fork of [phin](https://npmjs.com/package/phin) and [centra](https://npmjs.com/package/centra) by [Ethan Davis](https://etdavis.com/)
