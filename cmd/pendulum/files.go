package main

import (
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// What the listing can do to the folder it shows: make a directory, rename
// an entry, remove one. Every path is cleaned by Resolve first, which keeps
// all of it inside the folder the server runs over.
//
// Removal takes a file or an empty directory and nothing else. A recursive
// delete behind a web button takes everything under it on one click. A
// folder with something in it is emptied first, by the person reading what
// is in it.

var (
	errExists   = errors.New("something is already there")
	errRootPath = errors.New("the folder being edited stays")
	errNotEmpty = errors.New("the directory has something in it")
)

// Mkdir creates one directory, and the directories above it that a path
// names. It answers where it made it.
func (api *API) Mkdir(folder string) (Location, error) {
	clean := path.Clean("/" + strings.Trim(folder, "/"))
	location := Location{Type: "dir", Path: clean + "/", Name: path.Base(clean), Dir: path.Dir(clean)}

	full, err := api.Resolve(folder)
	if err != nil {
		return location, err
	}
	if full == api.Root {
		return location, errRootPath
	}
	if _, err := os.Stat(full); err == nil {
		return location, errExists
	}

	return location, os.MkdirAll(full, 0o755)
}

// Rename moves one entry inside the folder. The destination is a path, so
// the same call renames a file and moves it into another directory.
func (api *API) Rename(from, to string) (Location, error) {
	clean := path.Clean("/" + strings.Trim(to, "/"))
	location := Location{Type: "file", Path: clean, Name: path.Base(clean), Dir: path.Dir(clean)}

	source, err := api.Resolve(from)
	if err != nil {
		return location, err
	}
	target, err := api.Resolve(to)
	if err != nil {
		return location, err
	}
	if source == api.Root || target == api.Root {
		return location, errRootPath
	}

	info, err := os.Stat(source)
	if err != nil {
		return location, err
	}
	if info.IsDir() {
		location.Type = "dir"
		location.Path += "/"
	}

	if _, err := os.Stat(target); err == nil {
		return location, errExists
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return location, err
	}

	return location, os.Rename(source, target)
}

// Remove takes one file, or one directory with nothing in it.
func (api *API) Remove(entry string) error {
	full, err := api.Resolve(entry)
	if err != nil {
		return err
	}
	if full == api.Root {
		return errRootPath
	}

	info, err := os.Stat(full)
	if err != nil {
		return err
	}
	if info.IsDir() {
		rest, err := os.ReadDir(full)
		if err != nil {
			return err
		}
		if len(rest) > 0 {
			return errNotEmpty
		}
	}

	return os.Remove(full)
}
