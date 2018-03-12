# Pendulum

A simple editor for markdown/txt files. Supports saving changes into git repositories hosted anywhere (git add, git commit).

[Docker image](https://hub.docker.com/r/titpetric/pendulum) and [built binaries](https://github.com/titpetric/pendulum/releases) are provided.
Written by [@TitPetric](https://twitter.com/TitPetric) and licensed under the permissive [WTFPL](http://www.wtfpl.net/txt/copying/).

[![Codeship Status for titpetric/pendulum](https://app.codeship.com/projects/88ecf220-6806-0135-7d43-4a6204a3e72a/status?branch=master)](https://app.codeship.com/projects/241162)

## Running it in docker

To run it in Docker:

~~~
docker run -d --name pendulum \
	--restart=always \
	-p 8080:8080 \
	-v $(pwd):/app/contents \
	titpetric/pendulum
~~~

This will expose your current directory to Pendulum for editing. You can open the interface on
[http://localhost:8080/](http://localhost:8080/) and start editing those files right away.

## Download executable

There are binaries for 64bit Linux and Windows available on [the releases page](https://github.com/titpetric/pendulum/releases/latest).
Usage is simple. Download the .tgz file, unpack the binary and run it with any options like this:

~~~
# ./pendulum -?
flag provided but not defined: -?
Usage of pendulum:
  -addr string
        Address for server (default ":8080")
  -contents string
        Folder for display (default ".")
~~~

If you want to serve contents of a `test` folder on port 8081 you would run it as:

~~~
./pendulum -addr :8081 -contents test
~~~

It's also supported to pass the contents folder as a normal argument. This is the shortest way
of starting pendulum serving a custom folder: `./pendulum folder`.

## Screenshot

![](images/pendulum.png)

As you write or scroll either the textarea or the preview pane, the scroll positions are synchronised
based on percentage. In case of images in the text, accuracy can be quite off, but it's possible to
improve this behaviour in the future.

Most of the development is basically related with the preview of whatever it is you're
editing. The editor itself doesn't care about anything other than the contents of the text
file you're opening and trying to save.

## Thanks

If you want to thank me, please consider buying a book or three:

- [API Foundations in Go](https://leanpub.com/api-foundations)
- [12 Factor Applications with Docker and Go](https://leanpub.com/12fa-docker-golang)
- [The SaaS Handbook](https://leanpub.com/saas-handbook)

This project exists only because of the last book on the list.

## Why did I make this?

There's a distinct lack of friendly solutions that just let you point to a folder and edit a bunch
of text or markdown files. I wrote about three books on Leanpub (see above), and it was useful to
provide me with a way to review those markdown files. I'm also blogging with Hugo, used to blog with
Hexo, have some Jekyll files for my GitHub page, and I tend to write documentation with MkDocs.
That's about five systems which I actively write content into and those are just the public ones.

## How is it made?

There's a very simple API that powers the editor. The API provides exactly three calls:

1. `/api/list` - lists folders and files for navigation,
2. `/api/read` - reads a single file for editing,
3. `/api/store` - stores a single file contents (can create new files)

It operates exclusively on the `contents` folder and the files you provide in there. The editor
doesn't care what kind of files you put there, currently only files starting with a dot are excluded,
ie, `.git`, `.gitignore`,...

## Go server + API

A full HTTP server is implemented with Go. By default it listens on port 8080, but it's trivial
to change this, just by passing the `-addr` option when you run it.

~~~
go run *.go -addr :80
~~~

> **Note**: Pendulum supports git versioning. It does require you to set git config for `user.name`
> and `user.email`. Without those, Pendulum will not add/commit files, regardless if a git repository
> is present or not.


## Supported syntax

| Software | Type | Syntax | Support |
| -------- | ---- | ------ | ------- |
| Leanpub | Citation | `A> Note` | Yes |
| Leanpub | Pagebreak | `{pagebreak}` | Yes |
| Hugo | Pagebreak | `<!--more-->` | Yes |

I'm trying to add new features here. Feel free to submit a PR if there's a syntax you'd like to support, with the appropriate tests under `front/src/markdown/*`.

## Status

- [x] Full API for list, read and store,
- [x] Navigation of folders and files on the front-end,
- [x] Editor component with synchronised scrolling with preview,
- [x] Marked preview,
- [ ] (partially done) Add support for some of Leanpub syntax (`A>`, page break,...),
- [ ] Add support for some of Hugo syntax (`<!--more-->`, metadata, ...),
- [x] Actually save the contents that are being edited (client-side ajax),
- [x] Check if git has user.name && user.email set before commiting with git
- [x] Add git support to Go API
- [ ] Add option for HTTP auth
- [x] Deprecate/remove PHP API
- [x] Support images with relative links in rendering
- [x] Display images from preview markdown pane
- [ ] More markdown styling (done: blockquote, code, image, needs: tables,...)
- [x] Docker image for delivery
- [x] Go server for delivery
- [x] Git support from Go / Docker
- [x] Codeship CI,
- [x] Semver (sort of),
- [x] Pack public_html data into release binary
- [x] Downloadable builds on GitHub
- [x] Windows build
- [x] Create new files over front-end interface

I guess unit testing should be somewhere on the list, if this thing ever gets any traction.
