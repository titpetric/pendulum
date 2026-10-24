package main

import "net/http"

// Routes answers the whole of the server: five API calls, the folder being
// edited, and the frontend. net/http's own patterns carry the method and
// the wildcard, so there is no router to depend on.
func Routes(api *API) *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/list/{path...}", api.ListHandler)
	mux.HandleFunc("GET /api/read/{path...}", api.ReadHandler)
	mux.HandleFunc("POST /api/store/{path...}", api.StoreHandler)
	mux.HandleFunc("POST /api/preview", api.PreviewHandler)
	mux.HandleFunc("POST /api/upload", api.UploadHandler)

	mux.HandleFunc("GET /contents/{path...}", api.ContentsHandler)
	mux.HandleFunc("GET /", api.FrontendHandler)

	return mux
}
