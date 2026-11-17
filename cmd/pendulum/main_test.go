package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

// TestRoutes answers the editor bundle under /mdedit/.
func TestRoutes(t *testing.T) {
	t.Parallel()

	mux := Routes(fstest.MapFS{"mdedit.min.js": {Data: []byte("//")}}, &API{})
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/mdedit/mdedit.min.js", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status %d", w.Code)
	}
	if w.Body.String() != "//" {
		t.Fatalf("body %q", w.Body.String())
	}
}
