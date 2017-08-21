# Pendulum

A simple editor for markdown/txt files. Supports commiting changes into git repositories hosted
anywhere (git add, git commit). Choice of back-ends: Go or PHP.

Written by [@TitPetric](https://twitter.com/TitPetric) and licensed under the permissive [WTFPL](http://www.wtfpl.net/txt/copying/).

[![Codeship Status for titpetric/pendulum](https://app.codeship.com/projects/88ecf220-6806-0135-7d43-4a6204a3e72a/status?branch=master)](https://app.codeship.com/projects/241162)

## Running it in docker

To run it in Docker:

~~~
docker run -d --name pendulum \
	--restart=always \
	-p 8080:8080 \
	-v $(pwd):/app/contents \
	titpetric/pendulum -port 8080
~~~

This will expose your current directory to Pendulum for editing. You can open the interface on
[http://localhost/](http://localhost/) and start editing those files right away.

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

## PHP API

You can use either the Go API or the PHP API. With the PHP API you'll need to provide a HTTP server
in front of the app. The configuration for Nginx should look something like this:

~~~
location /api {
	try_files $uri /api/index.php;
}

location / {
	gzip on;
	gzip_static on;
	gzip_types *;
	index index.html;
	try_files $uri /index.html;
}
~~~

> **Note**: the PHP API call honors git repositories. In case the file you are editing is located
> in a git repository, Pendulum will add and commit this file when you save it. This way a full
> roll-back history is provided, should you ever need it.

The PHP API is implemented in PHP, using [Slim](https://www.slimframework.com/). Tested with PHP7.

## Go server + API

A full HTTP server is implemented with Go. By default it listens on port 80, but it's trivial
to change this, just by passing the `-port` option when you run it.

~~~
go run *.go -port 8080
~~~

> **Note**: Unlike the PHP API, this doesn't implement git versioning, yet. But you also don't
> need to setup and configure a nginx server, so there's that benefit.


## Status

- [x] Full API for list, read and store,
- [x] Navigation of folders and files on the front-end,
- [x] Editor component with synchronised scrolling with preview,
- [x] Marked preview,
- [ ] (partially done) Add support for some of Leanpub syntax (`A>`, page break,...),
- [ ] Add support for some of Hugo syntax (`<!--more-->`, metadata, ...),
- [x] Actually save the contents that are being edited (client-side ajax),
- [ ] Check if git has user.name && user.email set before commiting with git
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

I guess unit testing should be somewhere on the list, if this thing ever gets any traction.
