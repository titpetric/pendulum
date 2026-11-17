// Package pendulum carries the editor's frontend, built into the binary.
//
// front/ is plain HTML, CSS and ES modules with no build step, so what is
// embedded here is what a browser receives.
package pendulum

import (
	"embed"
	"io/fs"
)

//go:embed front/index.html front/app.js front/style.css front/logo.svg
//go:embed front/ext/titpetric/mdedit/dist
var tree embed.FS

// Front answers the frontend as a filesystem rooted at front/.
func Front() fs.FS {
	root, err := fs.Sub(tree, "front")
	if err != nil {
		panic(err)
	}
	return root
}

// MDEdit answers the editor's bundle as a filesystem rooted at its dist/.
func MDEdit() fs.FS {
	root, err := fs.Sub(tree, "front/ext/titpetric/mdedit/dist")
	if err != nil {
		panic(err)
	}
	return root
}
