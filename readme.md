# phn

A lightweight http client adapted from [phin](https://github.com/ethanent/phin) and [centra](https://github.com/ethanent/centra).

It works great with `node` and `bun` and comes with optional support for `zstd` compression via `fzstd`.


## install

> `npm i phn`

### optional: zstd

`phn` supports `zstd` compression if `fzstd` is installed (not included)

> `npm i phn fzstd`


## usage

``` js
const phn = require("phn");

const res = await phn({
	url: 'https://example.org'
});
```

### options

* `url` - URL to request
* `method` - HTTP method, default: `GET`
* `headers` - HTTP headers object
* `query` - Object to be added to `url` as query string
* `data` - Request body; json, buffer or object containing form data
* `form` - object containing form data
* `core` - options passed on to `http(s).request`
* `parse` - parse response body as `json` or `string`
* `followRedirects` - follow redirects if `true`
* `maxRedirects` - maximum number of redirects to follow, default: infinite
* `stream` - return stream as `res.stream` instead of `res.body`
* `compression` - handle compression, accept `br`, `gzip` and `deflate`, also `zstd` if `fzstd` package is installed. string overrides `accept-encoding` header
* `timeout` -  request timeout in milliseconds
* `maxBuffer` -  maximum response buffer size

### stream

consume http response as stream

``` js
const phn = require("phn");

const stream = await phn({
	url: 'https://example.org/',
	compression: true,
	stream: true,
});

stream.pipe(/* ... */)

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

get a classic callback interface

``` js
const phn = require("phn").unpromisified;

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

## comparison

`phn` is tiny and comes with no required dependencies.

Package | Size
--- | ---
phn | [![phn package size](https://packagephobia.now.sh/badge?p=phn)](https://packagephobia.now.sh/result?p=phn)
slim-fetch | [![slim-fetch package size](https://packagephobia.now.sh/badge?p=slim-fetch)](https://packagephobia.now.sh/result?p=slim-fetch)
phin | [![phin package size](https://packagephobia.now.sh/badge?p=phin)](https://packagephobia.now.sh/result?p=phin)
r2 | [![r2 package size](https://packagephobia.now.sh/badge?p=r2)](https://packagephobia.now.sh/result?p=r2)
isomorphic-fetch | [![isomorphic-fetch package size](https://packagephobia.now.sh/badge?p=isomorphic-fetch)](https://packagephobia.now.sh/result?p=isomorphic-fetch)
needle | [![needle package size](https://packagephobia.now.sh/badge?p=needle)](https://packagephobia.now.sh/result?p=needle)
undici | [![undici package size](https://packagephobia.now.sh/badge?p=undici)](https://packagephobia.now.sh/result?p=undici)
got | [![got package size](https://packagephobia.now.sh/badge?p=got)](https://packagephobia.now.sh/result?p=got)
superagent | [![superagent package size](https://packagephobia.now.sh/badge?p=superagent)](https://packagephobia.now.sh/result?p=superagent)
axios | [![axios package size](https://packagephobia.now.sh/badge?p=axios)](https://packagephobia.now.sh/result?p=axios)
request | [![request package size](https://packagephobia.now.sh/badge?p=request)](https://packagephobia.now.sh/result?p=request)
node-fetch | [![node-fetch package size](https://packagephobia.now.sh/badge?p=node-fetch)](https://packagephobia.now.sh/result?p=node-fetch)

## license

[MIT](./license.md)

## acknowledgement

`phn` is a fork of [phin](https://github.com/ethanent/phin) and [centra](https://github.com/ethanent/centra) by [Ethan Davis](https://github.com/ethanent).
