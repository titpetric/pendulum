// Package pendulum carries the editor's frontend, built into the binary.
//
// front/ is plain HTML, CSS and ES modules with no build step, so what is
// embedded here is what a browser receives.
package pendulum

import (
	"embed"
	"io/fs"
)

//go:embed all:front
var front embed.FS

// Front answers the frontend as a filesystem rooted at front/.
func Front() fs.FS {
	tree, err := fs.Sub(front, "front")
	if err != nil {
		panic(err)
	}
	return tree
}
