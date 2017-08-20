package main

import (
	"flag"
	"log"
	"os"
	"path"

	"net/http"
)

var port = flag.String("port", "80", "Port for server")

// Serves index.html in case the requested file isn't found (or some other os.Stat error)
func serveIndex(serve http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		indexPage := "./public_html/index.html"
		requestedPage := path.Join("./public_html", r.URL.Path)
		_, err := os.Stat(requestedPage)
		if err != nil {
			http.ServeFile(w, r, indexPage)
			return
		}
		serve.ServeHTTP(w, r)
	}
}

func main() {
	flag.Parse()

	api := API{
		Path: "./contents",
	}

	http.HandleFunc("/api/list/", api.ListHandler)
	http.HandleFunc("/api/read/", api.ReadHandler)
	http.HandleFunc("/api/store/", api.StoreHandler)

	http.HandleFunc("/", serveIndex(http.FileServer(http.Dir("./public_html"))))
	log.Println("Started listening on port", *port)
	if err := http.ListenAndServe(":"+*port, nil); err != nil {
		panic(err)
	}
}
