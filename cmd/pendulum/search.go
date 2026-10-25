package main

import (
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// Search over the folder being edited: the text a writer remembers writing,
// and the file it is in.
//
// No index and no watcher. A folder of posts is a few megabytes of text, and
// reading it costs less than keeping an index honest while an editor writes
// into it. The walk skips what a text search has no use for: dotted names,
// the assets a document carries, and any file that is not text.

const (
	// A document longer than this is not prose, and a search that reads it
	// pays for every byte.
	searchMaxBytes = 1 << 20

	// What one answer carries back, and how many answers one search is.
	searchLineWidth = 200
	searchMaxHits   = 200
)

// Hit is one line that carries the phrase.
type Hit struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Line int    `json:"line"`
	Text string `json:"text"`
}

// SearchResponse is what one search found, and whether it stopped early.
type SearchResponse struct {
	Query    string `json:"query"`
	Hits     []Hit  `json:"hits"`
	Files    int    `json:"files"`
	Capped   bool   `json:"capped"`
	Searched int    `json:"searched"`
}

// Search reads every text file under the folder for one phrase, ignoring
// case. It answers the lines that carry it, newest search semantics being
// the simplest: a substring, the way a reader would look for it.
func (api *API) Search(query string) (SearchResponse, error) {
	response := SearchResponse{Query: query, Hits: []Hit{}}

	needle := strings.ToLower(strings.TrimSpace(query))
	if needle == "" {
		return response, nil
	}

	err := filepath.WalkDir(api.Root, func(full string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		name := entry.Name()
		if strings.HasPrefix(name, ".") && full != api.Root {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			// An assets folder holds what a document points at.
			if name == "assets" {
				return filepath.SkipDir
			}
			return nil
		}
		if response.Capped {
			return filepath.SkipAll
		}

		info, err := entry.Info()
		if err != nil || info.Size() > searchMaxBytes || !info.Mode().IsRegular() {
			return nil
		}

		body, err := os.ReadFile(full)
		if err != nil || !utf8.Valid(body) {
			return nil
		}

		rel, err := filepath.Rel(api.Root, full)
		if err != nil {
			return nil
		}
		where := path.Join("/", filepath.ToSlash(rel))
		response.Searched++

		found := false
		for index, line := range strings.Split(string(body), "\n") {
			if !strings.Contains(strings.ToLower(line), needle) {
				continue
			}

			found = true
			response.Hits = append(response.Hits, Hit{
				Path: where,
				Name: path.Base(where),
				Line: index + 1,
				Text: clip(strings.TrimSpace(line), searchLineWidth),
			})
			if len(response.Hits) >= searchMaxHits {
				response.Capped = true
				break
			}
		}
		if found {
			response.Files++
		}

		return nil
	})

	return response, err
}

// clip shortens a line to what a result row can show.
func clip(line string, width int) string {
	if utf8.RuneCountInString(line) <= width {
		return line
	}

	return string([]rune(line)[:width]) + "..."
}
