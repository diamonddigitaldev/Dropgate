# Dropgate Docs Checks

Checks that the links in Dropgate's docs lead somewhere, and that the names the docs give match the code. They read the repository's Markdown and source, and run nothing from it. They never fetch a link, so nothing leaves your machine.


## What They Check

Every Markdown file in the repository, the READMEs and `docs/` alike:

* **Links.** Every relative link and image points to a file or folder in the repository, with the same case, because links on GitHub are case-sensitive. Every `#anchor` points to a heading or HTML anchor in that file, with the anchor GitHub gives it, or to a line of a code file (`#L12`). Links to other sites aren't fetched: they only have to use `https://`. Plain `http://` is fine to `localhost`.
* **Environment variables.** Every environment variable the docs name is one the code reads. Every one the server, the client and core read has a row in a table whose first column is "Variable", like the server README's.
* **Endpoints.** Every endpoint the docs name is one of the server's routes, and every route is named in the docs. The Web UI's own files, from `server/public/` and under `/vendor/`, aren't endpoints.
* **HTTP statuses.** Every status the docs name is one the server sends, and every status it sends has a row in a table whose first column is "Status" or "Code", like DGUP's error model.
* **Error codes.** Every error code the docs list is one the server, the client or core gives, and every one they give has a row in a table with a column headed "Code", like the error classes in core's [Errors](../../docs/core/errors.md) page.
* **Other names.** Every other UPPER_SNAKE_CASE name the docs put in code formatting, such as a constant, is somewhere in the code.
* **Core's npm README.** npm shows the README a version was published with, so [core's](../../packages/dropgate-core/README.md) stays short and points into the repository, and its docs are in [`docs/core/`](../../docs/core/README.md). Its only link into `docs/` is the docs' contents, `https://github.com/diamonddigitaldev/Dropgate/blob/master/docs/core/README.md`, never a page or an `#anchor`. Any other link into the repository is a file's full address on `master` (`https://github.com/diamonddigitaldev/Dropgate/blob/master/...`, with `?raw=true` for an image), and it has no relative links, which npm can't follow. The contents list every page of `docs/core/`, the README's example imports only what core exports, and core's error codes are listed in `docs/core/`. Each rule is also checked on a planted mistake.

They check that the names line up, not that what the docs say about them is true. That, and whether links to other sites still work, is checked by hand before each stable release.


## Running Them

Requires Node.js 24.14 or later, and git, which lists the repository's files. There's nothing to install. From this folder:

```bash
npm test
```

A failure lists each problem with its file and line. Files git ignores aren't checked, and new files are checked before you commit them.

GitHub Actions runs them on Ubuntu ([`ci.yml`](../../.github/workflows/ci.yml)).


## How They Find Names

The checks look for names written in these ways, so write them like this for the checks to see them:

* **An environment variable** has a row in a "Variable" table, or is set with a value (`LOG_LEVEL=DEBUG`, `-e ENABLE_UPLOAD=true` or `$env:ENABLE_UPLOAD="true"`, in text or in a code block), or is called one: "the `LOG_LEVEL` environment variable".
* **An endpoint** is a method and a path (`POST /upload/init`), a path on its own in code formatting (`/api/info`, `/p2p/<code>`), or an address on the server (`https://<host>/b/<bundleId>`). A placeholder can be written `<name>`, `:name` or `{name}`, and only stands for one of the route's own placeholders. A path ending in `/` names the routes under it, but each route still has to be named on its own somewhere. Paths under `/app/`, `/uploads/` and `/usr/` are folders on the server's disk, not endpoints.
* **An HTTP status** is a number in a status table, or one written as `HTTP 429`, `(507)`, "responds `200`", or with its reason, as in `200 OK`.
* **An error code** is a name in code formatting in a table column headed "Code" or `code`.
* **Any other name** is an UPPER_SNAKE_CASE word in inline code. Names in code blocks aren't read, because code blocks hold examples and placeholders.

And in the code:

* **Environment variables** are read with `process.env.LOG_LEVEL`, `process.env['LOG_LEVEL']` or `const { LOG_LEVEL } = process.env`.
* **Routes** are Express's calls in the server's own files, `server/*.js`: routers made with `express.Router()` and mounted with `app.use()`, and `app.get()`, `app.post()` and so on, with the path as a string or a constant.
* **Statuses** are `.status()`, `.sendStatus()` and `.writeHead()` with a number, in the same files.
* **Error codes** are set as `code: 'NOT_FOUND'`, or as a fallback, `code: opts.code || 'NOT_FOUND'`, and every entry of core's `ERROR_CODES` catalogue counts, given or not.

Comments aren't read. Core is read from its source, not from its copies in the server and the client.


## License

Licensed under the **AGPL-3.0 License**, like the server.
See the [LICENSE](../../LICENSE) file at the root of the repository for details.
