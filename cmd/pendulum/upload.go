package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
)

// Uploads stores what the editor pastes, drops or picks.
//
// A stored file lands in an assets/ folder beside the document it was
// pasted into, under a name this side chooses: pendulum_<ulid>.<ext>. The
// name the browser sent decides nothing except the extension, and the
// extension has to be one of Extensions. Beside each file sits
// pendulum_<ulid>.json with what was known about it at the time.
//
// The markdown gets a relative link (assets/pendulum_<ulid>.png), so the
// folder stays portable: whatever publishes it resolves the link the same
// way the preview does.
type Uploads struct {
	Root       string
	Extensions []string
}

// DefaultExtensions is what uploads without a -ext flag.
var DefaultExtensions = []string{"jpg", "jpeg", "png", "gif", "svg", "webp"}

const (
	uploadPrefix = "pendulum_"
	uploadFolder = "assets"

	// The largest upload accepted, and the ceiling multipart parsing is
	// given before it reads anything.
	maxUploadBytes = 16 << 20
)

// Meta is what is written beside a stored file.
type Meta struct {
	Name        string    `json:"name"`
	Original    string    `json:"original"`
	Extension   string    `json:"extension"`
	ContentType string    `json:"content_type"`
	Size        int64     `json:"size"`
	SHA256      string    `json:"sha256"`
	UploadedAt  time.Time `json:"uploaded_at"`
	Document    string    `json:"document"`
}

// NewUploads reads the allowlist: a comma separated list of extensions,
// with or without their dots.
func NewUploads(root, list string) (*Uploads, error) {
	uploads := &Uploads{Root: root}

	for _, item := range strings.Split(list, ",") {
		item = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(item), ".")))
		if item != "" {
			uploads.Extensions = append(uploads.Extensions, item)
		}
	}

	if len(uploads.Extensions) == 0 {
		return nil, errors.New("-ext needs at least one extension")
	}

	return uploads, nil
}

// Allows answers whether a filename carries an extension on the list.
func (u *Uploads) Allows(filename string) bool {
	return slicesContains(u.Extensions, extensionOf(filename))
}

// Refusal is the sentence the editor shows when a file is turned away. It
// names the list, because the writer cannot see the flag the server started
// with.
func (u *Uploads) Refusal() error {
	return fmt.Errorf("this server stores %s", strings.Join(u.Extensions, ", "))
}

// Store writes one upload beside `document` and answers the link the
// markdown should carry.
func (u *Uploads) Store(document string, part *multipart.FileHeader, file multipart.File) (string, Meta, error) {
	var meta Meta

	if !u.Allows(part.Filename) {
		return "", meta, u.Refusal()
	}

	folder := path.Dir(path.Clean("/" + strings.TrimPrefix(document, "/")))
	target := filepath.Join(u.Root, filepath.FromSlash(folder), uploadFolder)
	if !strings.HasPrefix(target, u.Root+string(os.PathSeparator)) && target != filepath.Join(u.Root, uploadFolder) {
		return "", meta, errOutsideRoot
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		return "", meta, err
	}

	body, err := io.ReadAll(io.LimitReader(file, maxUploadBytes+1))
	if err != nil {
		return "", meta, err
	}
	if len(body) > maxUploadBytes {
		return "", meta, fmt.Errorf("that file is over %d MB", maxUploadBytes>>20)
	}

	digest := sha256.Sum256(body)
	name := uploadPrefix + ulid.Make().String() + "." + extensionOf(part.Filename)

	meta = Meta{
		Name:        name,
		Original:    filepath.Base(part.Filename),
		Extension:   extensionOf(part.Filename),
		ContentType: part.Header.Get("Content-Type"),
		Size:        int64(len(body)),
		SHA256:      hex.EncodeToString(digest[:]),
		UploadedAt:  time.Now().UTC(),
		Document:    path.Clean("/" + strings.TrimPrefix(document, "/")),
	}

	if err := os.WriteFile(filepath.Join(target, name), body, 0o644); err != nil {
		return "", meta, err
	}

	sidecar, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return "", meta, err
	}

	sidecarName := strings.TrimSuffix(name, path.Ext(name)) + ".json"
	if err := os.WriteFile(filepath.Join(target, sidecarName), sidecar, 0o644); err != nil {
		return "", meta, err
	}

	return path.Join(uploadFolder, name), meta, nil
}

func extensionOf(filename string) string {
	return strings.ToLower(strings.TrimPrefix(path.Ext(filename), "."))
}

func slicesContains(list []string, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}
