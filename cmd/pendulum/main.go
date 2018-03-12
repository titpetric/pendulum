package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"path"
	"strings"

	"net/http"

	"github.com/elazarl/go-bindata-assetfs"
	"github.com/go-chi/chi"

	"github.com/titpetric/pendulum"
)

// Serves index.html in case the requested file isn't found (or some other os.Stat error)
func serveIndex(serve http.Handler, fs assetfs.AssetFS) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, err := fs.AssetInfo(path.Join(fs.Prefix, r.URL.Path))
		if err != nil {
			contents, err := fs.Asset(path.Join(fs.Prefix, "index.html"))
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "text/html")
			w.Write(contents)
			return
		}
		serve.ServeHTTP(w, r)
	}
}

// Serve contents - if file isn't found, strip last directory before trying once more
func serveContents(assetPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var err error

		tryFiles := []string{
			// layout: content/post/stub.md + content/post/stub/image.jpg
			path.Join(assetPath, r.URL.Path),
			path.Join(assetPath, path.Dir(path.Dir(r.URL.Path)), path.Base(r.URL.Path)),
		}
		// layout: content/post/stub.md + content/images/stub/image.jpg
		tryFiles = append(tryFiles, strings.Replace(tryFiles[0], "/post", "/images", 1))
		tryFiles = append(tryFiles, strings.Replace(tryFiles[1], "/post", "/images", 1))

		for _, requestedFile := range tryFiles {
			os.IsNotExist(err)
			if _, err = os.Stat(requestedFile); os.IsNotExist(err) {
				continue
			}
			http.ServeFile(w, r, requestedFile)
			return
		}
		http.Error(w, "File not found", http.StatusNotFound)
	}
}

func handleError(err error, message string) {
	if message == "" {
		message = "Error making API call"
	}
	if err != nil {
		log.Fatalf(message+": %v", err.Error())
	}
}

func main() {
	var (
		addr     = flag.String("addr", ":8080", "Address for server")
		contents = flag.String("contents", ".", "Folder for display")
	)
	flag.Parse()

	// log to stdout not stderr
	log.SetOutput(os.Stdout)

	if folder := flag.Arg(0); folder != "" {
		*contents = folder
	}

	assetPrefix := "dist"
	assets := assetfs.AssetFS{
		pendulum.Asset,
		pendulum.AssetDir,
		pendulum.AssetInfo,
		assetPrefix,
	}

	// Set absolute path to contents folder
	cwd, _ := os.Getwd()
	api := &API{
		Path: path.Join(cwd, *contents),
	}
	api.Contents = func (w http.ResponseWriter, r *http.Request) {
		http.StripPrefix("/contents/", serveContents(api.Path)).ServeHTTP(w, r)
	}
	api.Assets = serveIndex(http.FileServer(&assets), assets)

	// listen socket for http server
	log.Println("Starting http server on address " + *addr)
	listener, err := net.Listen("tcp", *addr)
	handleError(err, "Can't listen on addr "+*addr)

	// mount routes
	r := chi.NewRouter()
	MountRoutes(r, api)
	http.Serve(listener, r)
}
