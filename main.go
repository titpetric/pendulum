package main

import (
	"flag"
	"fmt"
	"log"
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
			w.Header().Set("Content-Type", "text/html")
			if err != nil {
				w.Write([]byte(fmt.Sprintf("%s", err)))
				return
			}
			w.Write(contents)
			return
		}
		serve.ServeHTTP(w, r)
	}
}

func main() {
	var (
		port = flag.String("port", "80", "Port for server")
		contents = flag.String("contents", "./contents", "Folder for display")
	)
	flag.Parse()

	api := API{
		Path: *contents,
	}

	assets := assetfs.AssetFS{
		Asset:     assets.Asset,
		AssetDir:  assets.AssetDir,
		AssetInfo: assets.AssetInfo,
		Prefix:    "dist",
	}
	server := http.FileServer(&assets)

	http.HandleFunc("/api/list/", api.ListHandler)
	http.HandleFunc("/api/read/", api.ReadHandler)
	http.HandleFunc("/api/store/", api.StoreHandler)

	// local folder
	http.Handle("/contents/", http.StripPrefix("/contents/", http.FileServer(http.Dir(*contents))))

	// served from bindata
	http.HandleFunc("/", serveIndex(server, assets))

	log.Println("Started listening on port", *port)
	if err := http.ListenAndServe(":"+*port, nil); err != nil {
		panic(err)
	}
}
