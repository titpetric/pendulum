package main

import (
	"github.com/go-chi/chi"
	"github.com/go-chi/chi/middleware"
	"github.com/go-chi/cors"
)

// MountRoutes will register API routes
func MountRoutes(r chi.Router, api *API) {
	// CORS for local development...
	cors := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		AllowCredentials: true,
		MaxAge:           300, // Maximum value not ignored by any of major browsers
	})
	r.Use(cors.Handler)
	r.Use(middleware.Logger)

	r.Route("/api", func(r chi.Router) {
		// List all jobs
		r.Get("/list/*", api.ListHandler)
		r.Get("/read/*", api.ReadHandler)
		r.Post("/store/*", api.StoreHandler)
	})

	// read from local storage
	r.Get("/contents/*", api.Contents)

	// served from bindata assets
	r.Get("/*", api.Assets)
}
