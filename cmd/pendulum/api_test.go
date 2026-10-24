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
