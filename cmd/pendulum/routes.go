package main

import "net/http"

// Routes answers the whole of the server: the API, the folder being edited,
// and the frontend. net/http's own patterns carry the method and the
// wildcard, so there is no router to depend on.
func Routes(api *API) *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/list/{path...}", api.ListHandler)
	mux.HandleFunc("GET /api/read/{path...}", api.ReadHandler)
	mux.HandleFunc("POST /api/store/{path...}", api.StoreHandler)
	mux.HandleFunc("POST /api/preview", api.PreviewHandler)
	mux.HandleFunc("POST /api/upload", api.UploadHandler)
	mux.HandleFunc("POST /api/mkdir/{path...}", api.MkdirHandler)
	mux.HandleFunc("POST /api/rename/{path...}", api.RenameHandler)
	mux.HandleFunc("POST /api/delete/{path...}", api.DeleteHandler)
	mux.HandleFunc("GET /api/search", api.SearchHandler)
	mux.HandleFunc("GET /api/settings", api.SettingsHandler)

	mux.HandleFunc("GET /contents/{path...}", api.ContentsHandler)
	mux.HandleFunc("GET /", api.FrontendHandler)

	return mux
}
