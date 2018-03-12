package main

import (
	"strings"
	"net/http"
)

func (api *API) ListHandler(w http.ResponseWriter, r *http.Request) {
	var err error

	response := struct {
		Response ListResponse `json:"response"`
	}{}

	response.Response.Folder = r.URL.Path
	response.Response.Files, err = api.List(strings.Replace(r.URL.Path, "/api/list", "", 1))
	if err != nil {
		api.ServeJSON(w, r, api.Error(err))
		return
	}
	api.ServeJSON(w, r, response)
}

func (api *API) ReadHandler(w http.ResponseWriter, r *http.Request) {
	var err error

	response := struct {
		Response ReadResponse `json:"response"`
	}{}
	response.Response, err = api.Read(strings.Replace(r.URL.Path, "/api/read", "", 1))

	if err != nil {
		api.ServeJSON(w, r, api.Error(err))
		return
	}
	api.ServeJSON(w, r, response)
}

func (api *API) StoreHandler(w http.ResponseWriter, r *http.Request) {
	var err error

	response := struct {
		Response StoreResponse `json:"response"`
	}{}
	response.Response, err = api.Store(strings.Replace(r.URL.Path, "/api/store", "", 1), r.PostFormValue("contents"))

	if err != nil {
		api.ServeJSON(w, r, api.Error(err))
		return
	}
	api.ServeJSON(w, r, response)
}
