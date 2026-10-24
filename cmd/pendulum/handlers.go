package main

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

func (api *API) ListHandler(w http.ResponseWriter, r *http.Request) {
	response, err := api.List(r.PathValue("path"))
	if err != nil {
		api.ServeError(w, http.StatusNotFound, err)
		return
	}

	api.ServeJSON(w, http.StatusOK, response)
}

func (api *API) ReadHandler(w http.ResponseWriter, r *http.Request) {
	response, err := api.Read(r.PathValue("path"))
	if err != nil {
		api.ServeError(w, http.StatusNotFound, err)
		return
	}

	api.ServeJSON(w, http.StatusOK, response)
}

func (api *API) StoreHandler(w http.ResponseWriter, r *http.Request) {
	response, err := api.Store(r.PathValue("path"), r.PostFormValue("contents"))
	if err != nil {
		api.ServeError(w, http.StatusBadRequest, err)
		return
	}

	api.ServeJSON(w, http.StatusOK, response)
}

// PreviewHandler renders the markdown as the preview pane shows it. The
// browser holds the text being typed, so the document arrives in the
// request; `path` is what relative image links resolve against.
func (api *API) PreviewHandler(w http.ResponseWriter, r *http.Request) {
	html, err := Render(r.PostFormValue("body"), r.PostFormValue("path"))
	if err != nil {
		api.ServeError(w, http.StatusBadRequest, err)
		return
	}

	api.ServeJSON(w, http.StatusOK, map[string]string{"html": html})
}

// UploadHandler takes one file from the editor and answers the link the
// markdown should carry.
func (api *API) UploadHandler(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		api.ServeError(w, http.StatusBadRequest, err)
		return
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()

	file, part, err := r.FormFile("file")
	if err != nil {
		api.ServeError(w, http.StatusBadRequest, errors.New("no file arrived under 'file'"))
		return
	}
	defer func() { _ = file.Close() }()

	document := r.FormValue("path")
	if document == "" {
		api.ServeError(w, http.StatusBadRequest, errors.New("which document is this for? 'path' was empty"))
		return
	}

	url, meta, err := api.Uploads.Store(document, part, file)
	if err != nil {
		api.ServeError(w, http.StatusUnsupportedMediaType, err)
		return
	}

	api.ServeJSON(w, http.StatusOK, map[string]any{"url": url, "name": meta.Name, "size": meta.Size})
}

// ContentsHandler serves the folder being edited: that is where the
// preview pane reads images that are not on the web yet.
//
// A folder of posts keeps its images in more than one shape: beside the
// document, in a folder named after it, in an assets/ folder beside it, or
// under /images where the document sits under /post. The link in the
// document is right for whatever publishes the folder, so this side is the
// one that tries harder.
func (api *API) ContentsHandler(w http.ResponseWriter, r *http.Request) {
	for _, candidate := range contentCandidates(path.Clean("/" + r.PathValue("path"))) {
		full, err := api.Resolve(candidate)
		if err != nil {
			continue
		}
		if info, err := os.Stat(full); err != nil || info.IsDir() {
			continue
		}

		http.ServeFile(w, r, full)
		return
	}

	http.Error(w, "file not found", http.StatusNotFound)
}

// contentCandidates answers the paths worth a look for one request, the
// literal one first: then the same path with any single directory dropped,
// which covers both a folder named after the post and an assets/ folder
// beside it, and last the /post to /images swap.
func contentCandidates(requested string) []string {
	dirs := strings.Split(strings.Trim(path.Dir(requested), "/"), "/")
	base := path.Base(requested)

	candidates := []string{requested}
	if len(dirs) > 0 && dirs[0] != "" {
		for i := range dirs {
			shorter := append(append([]string{}, dirs[:i]...), dirs[i+1:]...)
			candidates = append(candidates, path.Join("/", path.Join(shorter...), base))
		}
	}

	for _, candidate := range candidates[:min(len(candidates), 2)] {
		if swapped := strings.Replace(candidate, "/post", "/images", 1); swapped != candidate {
			candidates = append(candidates, swapped)
		}
	}

	return candidates
}

// FrontendHandler serves the embedded frontend, answering index.html for
// any path it does not hold: the editor keeps its state in the URL, so
// /edit/notes.md has to reach the page that reads it.
func (api *API) FrontendHandler(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name == "" {
		name = "index.html"
	}

	if _, err := fs.Stat(api.Frontend, name); err != nil {
		name = "index.html"
	}

	body, err := fs.ReadFile(api.Frontend, name)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", contentType(name))
	_, _ = w.Write(body)
}

func contentType(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".html":
		return "text/html; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".js":
		return "text/javascript; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".json":
		return "application/json"
	}

	return "application/octet-stream"
}
