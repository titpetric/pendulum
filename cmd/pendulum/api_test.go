package main

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// newServer stands up the whole router over a scratch folder: what the
// browser talks to, with nothing stubbed.
func newServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()

	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "post"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "post", "stub.md"), []byte("# Hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	uploads, err := NewUploads(root, strings.Join(DefaultExtensions, ","))
	if err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(Routes(&API{Root: root, Uploads: uploads, Frontend: os.DirFS(root)}))
	t.Cleanup(server.Close)

	return server, root
}

func TestAPIListReadStore(t *testing.T) {
	server, root := newServer(t)

	var listing ListResponse
	get(t, server.URL+"/api/list/", &listing)
	if len(listing.Files) != 1 || listing.Files[0].Name != "post" {
		t.Fatalf("listing: %+v", listing.Files)
	}

	var read ReadResponse
	get(t, server.URL+"/api/read/post/stub.md", &read)
	if read.Contents != "# Hello\n" {
		t.Errorf("contents: %q", read.Contents)
	}

	// A file that does not exist reads as an empty page: that is how the
	// editor opens a new one.
	get(t, server.URL+"/api/read/post/fresh.md", &read)
	if read.Contents != "" {
		t.Errorf("a missing file should read empty, got %q", read.Contents)
	}

	var stored StoreResponse
	post(t, server.URL+"/api/store/post/fresh.md", url.Values{"contents": {"written\n"}}, &stored)
	if stored.Status != "ok" {
		t.Errorf("store: %+v", stored)
	}

	written, err := os.ReadFile(filepath.Join(root, "post", "fresh.md"))
	if err != nil || string(written) != "written\n" {
		t.Errorf("stored file: %q %v", written, err)
	}

	// A browser puts a text field through a multipart form as CRLF, whatever
	// the author typed. What lands on disk is the document the author wrote.
	post(t, server.URL+"/api/store/post/fresh.md", url.Values{"contents": {"one\r\ntwo\rthree\n"}}, &stored)
	written, err = os.ReadFile(filepath.Join(root, "post", "fresh.md"))
	if err != nil || string(written) != "one\ntwo\nthree\n" {
		t.Errorf("line endings: %q %v", written, err)
	}
}

func TestAPIPreview(t *testing.T) {
	server, _ := newServer(t)

	var answer map[string]string
	post(t, server.URL+"/api/preview", url.Values{
		"body": {"# Hi\n\n![](assets/a.png)\n"},
		"path": {"/post/stub.md"},
	}, &answer)

	if !strings.Contains(answer["html"], "<h1>Hi</h1>") {
		t.Errorf("html: %q", answer["html"])
	}
	if !strings.Contains(answer["html"], `src="/contents/post/stub/assets/a.png"`) {
		t.Errorf("the image should resolve against the document: %q", answer["html"])
	}
}

func TestAPIUploadAndServe(t *testing.T) {
	server, _ := newServer(t)

	body, contentType := upload(t, "shot.png", "image/png", "pretend-png")

	response, err := http.Post(server.URL+"/api/upload", contentType, body)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()

	var answer map[string]any
	if err := json.NewDecoder(response.Body).Decode(&answer); err != nil {
		t.Fatal(err)
	}

	link, _ := answer["url"].(string)
	if !strings.HasPrefix(link, "assets/pendulum_") {
		t.Fatalf("url: %v", answer)
	}

	// The preview requests the link under the document's own folder, and
	// the file sits beside the document: the candidate ladder bridges the
	// two.
	served, err := http.Get(server.URL + "/contents/post/stub/" + link)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = served.Body.Close() }()

	if served.StatusCode != http.StatusOK {
		t.Fatalf("serving the upload: %d", served.StatusCode)
	}

	stored, _ := io.ReadAll(served.Body)
	if string(stored) != "pretend-png" {
		t.Errorf("served: %q", stored)
	}
}

func TestAPIUploadRefusesExtension(t *testing.T) {
	server, _ := newServer(t)

	body, contentType := upload(t, "song.mp3", "audio/mpeg", "ID3")

	response, err := http.Post(server.URL+"/api/upload", contentType, body)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode != http.StatusUnsupportedMediaType {
		t.Errorf("status: %d", response.StatusCode)
	}

	var answer map[string]string
	if err := json.NewDecoder(response.Body).Decode(&answer); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(answer["error"], "jpg") {
		t.Errorf("error: %q", answer["error"])
	}
}

// TestAPIStaysInsideRoot pins the guard: an encoded traversal reads nothing
// above the folder the server runs in.
func TestAPIStaysInsideRoot(t *testing.T) {
	server, _ := newServer(t)

	var read ReadResponse
	get(t, server.URL+"/api/read/%2e%2e%2f%2e%2e%2fetc/passwd", &read)

	if read.Contents != "" {
		t.Errorf("read outside the root: %q", read.Contents)
	}
}

func upload(t *testing.T, filename, contentType, body string) (io.Reader, string) {
	t.Helper()

	var buffer bytes.Buffer
	writer := multipart.NewWriter(&buffer)

	header := make(map[string][]string)
	header["Content-Disposition"] = []string{`form-data; name="file"; filename="` + filename + `"`}
	header["Content-Type"] = []string{contentType}

	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte(body)); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("path", "/post/stub.md"); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	return &buffer, writer.FormDataContentType()
}

func get(t *testing.T, url string, into any) {
	t.Helper()

	response, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()

	if err := json.NewDecoder(response.Body).Decode(into); err != nil {
		t.Fatal(err)
	}
}

func post(t *testing.T, url string, values url.Values, into any) {
	t.Helper()

	response, err := http.PostForm(url, values)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()

	if err := json.NewDecoder(response.Body).Decode(into); err != nil {
		t.Fatal(err)
	}
}

// The listing's own actions: a directory made, an entry renamed, an entry
// removed. Issue #6.
func TestAPIFileActions(t *testing.T) {
	server, root := newServer(t)

	var made Location
	post(t, server.URL+"/api/mkdir/notes/2026", url.Values{}, &made)
	if made.Type != "dir" || made.Path != "/notes/2026/" {
		t.Fatalf("mkdir: %+v", made)
	}
	if info, err := os.Stat(filepath.Join(root, "notes", "2026")); err != nil || !info.IsDir() {
		t.Fatalf("the directory is not there: %v", err)
	}

	// Making it again answers with the reason.
	var again map[string]string
	post(t, server.URL+"/api/mkdir/notes/2026", url.Values{}, &again)
	if again["error"] == "" {
		t.Errorf("a directory already there: %+v", again)
	}

	// A rename moves the file and carries its new name back.
	var moved Location
	post(t, server.URL+"/api/rename/post/stub.md", url.Values{"to": {"/notes/2026/moved.md"}}, &moved)
	if moved.Path != "/notes/2026/moved.md" {
		t.Fatalf("rename: %+v", moved)
	}
	if _, err := os.Stat(filepath.Join(root, "post", "stub.md")); !os.IsNotExist(err) {
		t.Errorf("the file is still where it was")
	}
	if _, err := os.Stat(filepath.Join(root, "notes", "2026", "moved.md")); err != nil {
		t.Errorf("the file is not where it went: %v", err)
	}

	// A directory with something in it stays.
	var refused map[string]string
	post(t, server.URL+"/api/delete/notes", url.Values{}, &refused)
	if refused["error"] == "" {
		t.Errorf("a directory with a file in it: %+v", refused)
	}

	// A file goes, and so does the directory it leaves empty.
	var gone map[string]string
	post(t, server.URL+"/api/delete/notes/2026/moved.md", url.Values{}, &gone)
	if gone["status"] != "ok" {
		t.Fatalf("delete: %+v", gone)
	}
	post(t, server.URL+"/api/delete/notes/2026", url.Values{}, &gone)
	if gone["status"] != "ok" {
		t.Fatalf("delete the empty directory: %+v", gone)
	}
	if _, err := os.Stat(filepath.Join(root, "notes", "2026")); !os.IsNotExist(err) {
		t.Errorf("the directory is still there")
	}
}

// Nothing reaches outside the folder being edited. A traversal in the URL
// never arrives: net/http cleans the path and redirects. One in a form
// field does arrive, and the guard answers it.
func TestAPIFileActionsStayInsideRoot(t *testing.T) {
	server, root := newServer(t)

	var moved Location
	post(t, server.URL+"/api/rename/post/stub.md", url.Values{"to": {"../outside.md"}}, &moved)
	if moved.Path != "/outside.md" {
		t.Errorf("a climbing path names one inside the folder: %+v", moved)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(root), "outside.md")); !os.IsNotExist(err) {
		t.Errorf("a file landed outside the folder being edited")
	}
	if _, err := os.Stat(filepath.Join(root, "outside.md")); err != nil {
		t.Errorf("the file landed somewhere else: %v", err)
	}

	// Under the handlers, a climbing path is cleaned to one inside the
	// folder before anything acts on it, the way reading and storing
	// already treat one: `../outside` names `/outside` here.
	api := &API{Root: root}
	if _, err := api.Mkdir("../outside"); err != nil {
		t.Errorf("mkdir: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "outside")); err != nil {
		t.Errorf("the directory landed somewhere else: %v", err)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(root), "outside")); !os.IsNotExist(err) {
		t.Errorf("a directory landed above the folder being edited")
	}

	if err := api.Remove("../../etc/passwd"); err == nil {
		t.Errorf("a delete of a file that is not there")
	}
	if err := api.Remove("/"); err == nil {
		t.Errorf("the folder being edited went")
	}
}

// Search reads the folder for a phrase and answers the lines carrying it.
// Issue #7.
func TestAPISearch(t *testing.T) {
	server, root := newServer(t)

	if err := os.WriteFile(filepath.Join(root, "post", "salt.md"), []byte("# Salt\n\nSalt the water.\nTwice.\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "post", "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "post", "assets", "notes.txt"), []byte("salt\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	var found SearchResponse
	get(t, server.URL+"/api/search?q=salt", &found)

	if len(found.Hits) != 2 {
		t.Fatalf("hits: %+v", found.Hits)
	}
	if found.Hits[0].Path != "/post/salt.md" || found.Hits[0].Line != 1 {
		t.Errorf("first hit: %+v", found.Hits[0])
	}
	if found.Hits[1].Line != 3 || found.Hits[1].Text != "Salt the water." {
		t.Errorf("second hit: %+v", found.Hits[1])
	}
	if found.Files != 1 {
		t.Errorf("an assets folder holds what a document points at, not prose: %d files", found.Files)
	}

	// An empty query reads nothing.
	get(t, server.URL+"/api/search?q=", &found)
	if len(found.Hits) != 0 || found.Searched != 0 {
		t.Errorf("an empty query: %+v", found)
	}
}

// The page cannot see the flags the server started with, so it asks.
func TestAPISettings(t *testing.T) {
	server, _ := newServer(t)

	var settings map[string]any
	get(t, server.URL+"/api/settings", &settings)

	if _, ok := settings["autosave_seconds"]; !ok {
		t.Errorf("settings: %+v", settings)
	}
	if _, ok := settings["extensions"]; !ok {
		t.Errorf("settings: %+v", settings)
	}
}
