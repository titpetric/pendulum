# Pendulum

A simple editor for markdown/txt files. Supports commiting changes into git repositories hosted
anywhere (git add, git commit).

## Why did I make this?

There's a distinct lack of friendly sollutions that just let you point to a folder and edit a bunch
of text or markdown files. I wrote about three books on Leanpub (see below), and it was useful to
provide me with a way to review those markdown files. I'm also blogging with Hugo, used to blog with
Hexo, have some Jekyll files for my GitHub page, and I tend to write documentation with MkDocs.
That's about five systems which I actively write content into and those are just the public ones.

## How is it made?

There's a very simple API that powers the editor. The API provides exactly three calls:

1. `/api/list` - lists folders and files for navigation,
2. `/api/read` - reads a single file for editing,
3. `/api/store` - stores a single file contents (can create new files)

It operates exclusively on the `contents` folder and the files you provide in there. The editor
doesn't care what kind of files you put there. It's just going to have some difficulty with image
tags, but maybe I'll work on that in the future? :)

**Note**: the store API call honors git repositories. In case the file you are editing is located
in a git repository, Pendulum will add and commit this file when you save it. This way a full
roll-back history is provided, should you ever need it.

The API is implemented in PHP, using [Slim](https://www.slimframework.com/). It would be trivial
to implement the same api in Go or Node, and I might do it in the future. If you'd like that, let
me know on Twitter [@TitPetric](https://twitter.com/TitPetric).

Nginx configuration should look something like this:

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

I'm planning a Docker image as well, which would take away some of the pain. Currently
this is only for hackers.

## Screenshot for us visual types?

![](images/pendulum.png)

As you write or scroll either the textarea or the preview pane, the scroll positions are synchronised
based on percentage. In case of images in the text, accuracy can be quite off, but it's possible to
improve this behaviour in the future.

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
- [ ] More markdown styling (done: blockquote, code, image, needs: tables,...)
- [ ] Docker image for delivery
- [ ] Go server for delivery, windows

Most of the development is basically related with the preview of whatever it is you're
editing. The editor itself doesn't care about anything other than the contents of the text
file you're opening and trying to save. Simple. I guess unit testing should be somewhere
on the list, if this thing ever gets any traction.

## Thanks

If you want to thank me, please consider buying a book or three:

- [API Foundations in Go](https://leanpub.com/api-foundations)
- [12 Factor Applications with Docker and Go](https://leanpub.com/12fa-docker-golang)
- [The SaaS Handbook](https://leanpub.com/saas-handbook)

This project exists only because of the last book on the list.

## License

The code is provided under a permit-everything license, WTFPL.