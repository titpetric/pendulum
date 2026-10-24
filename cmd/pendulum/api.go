package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// API serves one folder: everything it reads, writes and stores stays under
// Root, and Resolve is what holds that line.
type API struct {
	Root     string
	Uploads  *Uploads
	Frontend fs.FS
}

// Location is one entry in a folder listing.
type Location struct {
	Type         string    `json:"type"`
	Path         string    `json:"path"`
	Name         string    `json:"name"`
	Dir          string    `json:"dir"`
	LastModified time.Time `json:"last_modified"`
}

// ListResponse is a folder and what is in it, directories first.
type ListResponse struct {
	Folder string     `json:"folder"`
	Files  []Location `json:"files"`
}

// ReadResponse is one file and its contents. A file that does not exist
// answers empty contents: the editor opens a new file that way.
type ReadResponse struct {
	Location
	Contents string `json:"contents"`
}

// StoreResponse carries whatever git had to say about the commit.
type StoreResponse struct {
	Status string `json:"status"`
	Log    string `json:"log"`
}

var errOutsideRoot = errors.New("path is outside the folder being edited")

// Resolve answers the absolute path for a request path, refusing anything
// that climbs out of Root. A browser can send ../../etc/passwd, and the
// editor serves whatever folder it runs in.
func (api *API) Resolve(requested string) (string, error) {
	clean := path.Clean("/" + strings.TrimPrefix(requested, "/"))
	full := filepath.Join(api.Root, filepath.FromSlash(clean))

	if full != api.Root && !strings.HasPrefix(full, api.Root+string(os.PathSeparator)) {
		return "", errOutsideRoot
	}

	return full, nil
}

func (api *API) List(folder string) (ListResponse, error) {
	response := ListResponse{Folder: path.Clean("/" + strings.Trim(folder, "/")), Files: []Location{}}

	full, err := api.Resolve(folder)
	if err != nil {
		return response, err
	}

	entries, err := os.ReadDir(full)
	if err != nil {
		return response, err
	}

	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		location := Location{
			Type:         "file",
			Path:         path.Join(response.Folder, name),
			Name:         name,
			Dir:          response.Folder,
			LastModified: info.ModTime(),
		}
		if entry.IsDir() {
			location.Type = "dir"
			location.Path += "/"
		}

		response.Files = append(response.Files, location)
	}

	sort.Slice(response.Files, func(i, j int) bool {
		if response.Files[i].Type != response.Files[j].Type {
			return response.Files[i].Type == "dir"
		}
		return strings.ToLower(response.Files[i].Name) < strings.ToLower(response.Files[j].Name)
	})

	return response, nil
}

func (api *API) Read(file string) (ReadResponse, error) {
	clean := path.Clean("/" + strings.TrimPrefix(file, "/"))
	response := ReadResponse{
		Location: Location{
			Type:         "file",
			Path:         clean,
			Name:         path.Base(clean),
			Dir:          path.Dir(clean),
			LastModified: time.Now(),
		},
	}

	full, err := api.Resolve(file)
	if err != nil {
		return response, err
	}

	info, err := os.Stat(full)
	if err != nil {
		// A file that is not there yet is the editor's empty page.
		if os.IsNotExist(err) {
			return response, nil
		}
		return response, err
	}
	if !info.Mode().IsRegular() {
		return response, errors.New("not a file: " + clean)
	}

	contents, err := os.ReadFile(full)
	if err != nil {
		return response, err
	}

	response.LastModified = info.ModTime()
	response.Contents = string(contents)

	return response, nil
}

func (api *API) Store(file, contents string) (StoreResponse, error) {
	response := StoreResponse{Status: "ok"}

	full, err := api.Resolve(file)
	if err != nil {
		return response, err
	}

	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return response, err
	}
	if err := os.WriteFile(full, []byte(contents), 0o644); err != nil {
		return response, err
	}

	git := Git{Filename: full}
	response.Log, err = git.Commit()

	return response, err
}

// ServeJSON writes one JSON document. Every API answer calls it, so the
// content type and the encoding are set in one place.
func (api *API) ServeJSON(w http.ResponseWriter, status int, response any) {
	body, err := json.MarshalIndent(response, "", "  ")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if _, err := w.Write(body); err != nil {
		log.Printf("writing response: %v", err)
	}
}

// ServeError answers the shape the frontend reads for every failure,
// including the uploader in mdedit.
func (api *API) ServeError(w http.ResponseWriter, status int, err error) {
	api.ServeJSON(w, status, map[string]string{"error": err.Error()})
}
