package main

import (
	"flag"
	"log"
	"os"
	"path"

	"net/http"

	"github.com/elazarl/go-bindata-assetfs"

	"app/assets"
)

//go:generate go-bindata -prefix front/src -o assets/bindata.go -pkg assets -nomemcopy front/src/dist/...

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

func main() {
	var (
		port     = flag.String("port", "8080", "Port for server")
		contents = flag.String("contents", "contents", "Folder for display")
	)
	flag.Parse()

	if folder := flag.Arg(0); folder != "" {
		*contents = folder
	}

	// Set absolute path to contents folder
	cwd, _ := os.Getwd()
	api := API{
		Path: path.Join(cwd, *contents),
	}

	assetPrefix := "dist"
	assets := assetfs.AssetFS{
		assets.Asset,
		assets.AssetDir,
		assets.AssetInfo,
		assetPrefix,
	}
	server := http.FileServer(&assets)

	http.HandleFunc("/api/list/", api.ListHandler)
	http.HandleFunc("/api/read/", api.ReadHandler)
	http.HandleFunc("/api/store/", api.StoreHandler)

	// local folder
	http.Handle("/contents/", http.StripPrefix("/contents/", http.FileServer(http.Dir(api.Path))))

	// served from bindata
	http.HandleFunc("/", serveIndex(server, assets))

	log.Println("Started listening on port", *port)
	if err := http.ListenAndServe(":"+*port, nil); err != nil {
		panic(err)
	}
}
