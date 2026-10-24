package main

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUploadsAllows(t *testing.T) {
	uploads, err := NewUploads(t.TempDir(), "jpg, .PNG ,")
	if err != nil {
		t.Fatal(err)
	}

	if got, want := strings.Join(uploads.Extensions, ","), "jpg,png"; got != want {
		t.Errorf("extensions: got %q want %q", got, want)
	}

	for name, want := range map[string]bool{
		"photo.jpg":   true,
		"photo.JPG":   true,
		"shot.png":    true,
		"song.mp3":    false,
		"diagram.svg": false,
		"noextension": false,
	} {
		if got := uploads.Allows(name); got != want {
			t.Errorf("%s: got %v want %v", name, got, want)
		}
	}

	if _, err := NewUploads(t.TempDir(), " , "); err == nil {
		t.Error("an empty allowlist should be refused")
	}
}

func TestUploadsStore(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "post"), 0o755); err != nil {
		t.Fatal(err)
	}

	uploads, err := NewUploads(root, strings.Join(DefaultExtensions, ","))
	if err != nil {
		t.Fatal(err)
	}

	part, file := multipartFile(t, "Pasted Shot.PNG", "image/png", "pretend-png-bytes")

	url, meta, err := uploads.Store("/post/stub.md", part, file)
	if err != nil {
		t.Fatal(err)
	}

	// The link is relative to the document, so whatever publishes the
	// folder resolves it the same way the preview does.
	if !strings.HasPrefix(url, "assets/pendulum_") || !strings.HasSuffix(url, ".png") {
		t.Errorf("url: got %q", url)
	}

	stored := filepath.Join(root, "post", "assets", meta.Name)
	if _, err := os.Stat(stored); err != nil {
		t.Fatalf("stored file: %v", err)
	}

	sidecar := strings.TrimSuffix(stored, ".png") + ".json"
	body, err := os.ReadFile(sidecar)
	if err != nil {
		t.Fatalf("metadata: %v", err)
	}

	var written Meta
	if err := json.Unmarshal(body, &written); err != nil {
		t.Fatal(err)
	}

	if written.Original != "Pasted Shot.PNG" {
		t.Errorf("original: got %q", written.Original)
	}
	if written.Extension != "png" {
		t.Errorf("extension: got %q", written.Extension)
	}
	if written.Size != int64(len("pretend-png-bytes")) {
		t.Errorf("size: got %d", written.Size)
	}
	if written.Document != "/post/stub.md" {
		t.Errorf("document: got %q", written.Document)
	}
	if len(written.SHA256) != 64 {
		t.Errorf("sha256: got %q", written.SHA256)
	}
}

func TestUploadsRefusesExtension(t *testing.T) {
	uploads, err := NewUploads(t.TempDir(), "jpg,png")
	if err != nil {
		t.Fatal(err)
	}

	part, file := multipartFile(t, "song.mp3", "audio/mpeg", "ID3")

	_, _, err = uploads.Store("/notes.md", part, file)
	if err == nil {
		t.Fatal("an mp3 should be refused")
	}
	if !strings.Contains(err.Error(), "jpg, png") {
		t.Errorf("the refusal should name the list, got %q", err)
	}

	if entries, _ := os.ReadDir(filepath.Join(uploads.Root, "assets")); len(entries) != 0 {
		t.Error("a refused upload should write nothing")
	}
}

// multipartFile builds the part a browser would send.
func multipartFile(t *testing.T, filename, contentType, body string) (*multipart.FileHeader, multipart.File) {
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
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	form, err := multipart.NewReader(&buffer, writer.Boundary()).ReadForm(1 << 20)
	if err != nil {
		t.Fatal(err)
	}

	parts := form.File["file"]
	if len(parts) != 1 {
		t.Fatalf("expected one part, got %d", len(parts))
	}

	file, err := parts[0].Open()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = file.Close() })

	return parts[0], file
}
