package main

import (
	"bytes"
	"path"
	"regexp"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/renderer/html"
)

// The preview renders here, so the editor ships no markdown parser of its
// own. Raw HTML passes through: a document that
// carries a <div> or an <iframe> is the author's own file, on the author's
// own machine.
var markdown = goldmark.New(
	goldmark.WithExtensions(extension.GFM),
	goldmark.WithRendererOptions(html.WithUnsafe()),
)

var (
	// A page break is a hugo more-divider or a leanpub marker.
	pageBreaks = regexp.MustCompile(`(?mi)^(<!--more-->|\{pagebreak\})`)

	// Leanpub asides open with A>, which markdown reads as a paragraph.
	leanpubAside = regexp.MustCompile(`(?m)^A>`)

	// Hugo and hexo write images through a shortcode. Hexo spells it
	// `{% asset_img url "caption" %}`; hugo takes double braces and quotes
	// the address, `{{% asset_img "url" "caption" %}}`. Both forms read
	// here, with the braces, the quotes and the caption each optional, so a
	// folder of posts written for either renders without being touched.
	hugoAsset      = regexp.MustCompile(`\{\{?%\s*asset_img\s+["']?([^\s"']+)["']?\s*%\}\}?`)
	hugoAssetTitle = regexp.MustCompile(`\{\{?%\s*asset_img\s+["']?([^\s"']+)["']?\s+["']([^"']+)["']\s*%\}\}?`)

	// An image link, title and target apart.
	imageLink = regexp.MustCompile(`!\[([^\]]*)\]\(([^)]+)\)`)

	// A rendered link, which the pass below reads to find the ones naming a
	// file a browser can play. markup strips the emphasis out of a link's
	// text: an attribute holds characters, not elements.
	anchorLink = regexp.MustCompile(`<a href="([^"]*)"[^>]*>(.*?)</a>`)
	markup     = regexp.MustCompile(`<[^>]*>`)
)

// mediaExtensions names the files a browser can play, by the player each one
// needs. The editing surface beside this pane draws the same links as
// players, and this is mdedit's own list: two panes over one document that
// disagreed about it would be two documents.
var mediaExtensions = map[string]string{
	"mp3": "audio", "m4a": "audio", "aac": "audio", "oga": "audio", "ogg": "audio",
	"opus": "audio", "wav": "audio", "flac": "audio", "weba": "audio",
	"mp4": "video", "m4v": "video", "webm": "video", "ogv": "video", "mov": "video",
}

// MediaKind answers "audio", "video", or an empty string for an address that
// names neither. A query or a fragment on the end says nothing about the
// file, so neither is read.
func MediaKind(href string) string {
	address := href
	if cut := strings.IndexAny(address, "?#"); cut >= 0 {
		address = address[:cut]
	}
	dot := strings.LastIndex(address, ".")
	if dot < 0 {
		return ""
	}

	return mediaExtensions[strings.ToLower(address[dot+1:])]
}

// players turns a link to a recording or a capture into the player for it.
// The element loads its length and no more until the reader plays it, so a
// document carrying an hour of audio costs one short request to preview.
func players(rendered string) string {
	if !strings.Contains(rendered, "<a href=") {
		return rendered
	}

	return anchorLink.ReplaceAllStringFunc(rendered, func(match string) string {
		parts := anchorLink.FindStringSubmatch(match)
		kind := MediaKind(parts[1])
		if kind == "" {
			return match
		}

		label := strings.ReplaceAll(strings.TrimSpace(markup.ReplaceAllString(parts[2], "")), `"`, "&quot;")
		return "<" + kind + ` class="media" controls preload="metadata" src="` + parts[1] +
			`" title="` + label + `" aria-label="` + label + `"></` + kind + ">"
	})
}

// Render answers the HTML the preview pane shows for one document.
// `document` is the path being edited: the relative links in it resolve
// against that.
func Render(body, document string) (string, error) {
	var out bytes.Buffer
	if err := markdown.Convert([]byte(Transform(body, document)), &out); err != nil {
		return "", err
	}

	// A link to a file a browser can play is a player. Code blocks are
	// escaped by now, so a link shown as code stays the text it is.
	return players(out.String()), nil
}

// Transform rewrites the document before markdown sees it: the conventions
// a folder of posts carries that markdown has no syntax for.
func Transform(body, document string) string {
	body = transformMeta(body)
	body = pageBreaks.ReplaceAllString(body, `<hr class="pagebreak"/>`)
	body = leanpubAside.ReplaceAllString(body, ">")
	body = hugoAssetTitle.ReplaceAllString(body, "![$2]($1)")
	body = hugoAsset.ReplaceAllString(body, "![]($1)")
	body = transformImages(body, PreviewBase(document))

	return body
}

// PreviewBase answers the URL a relative link in `document` resolves
// against: the document's own name without its extension, under /contents.
// An image folder named after the post resolves there directly, and
// anything else falls back through ContentsHandler.
func PreviewBase(document string) string {
	clean := path.Clean("/" + strings.TrimPrefix(document, "/"))
	stem := strings.TrimSuffix(clean, path.Ext(clean))

	return path.Join("/contents", stem) + "/"
}

// transformImages points relative images at the folder being edited.
// Absolute links and links to another host are left as they are.
func transformImages(body, base string) string {
	return imageLink.ReplaceAllStringFunc(body, func(match string) string {
		parts := imageLink.FindStringSubmatch(match)
		target := parts[2]

		switch {
		case strings.HasPrefix(target, "http://"),
			strings.HasPrefix(target, "https://"),
			strings.HasPrefix(target, "//"),
			strings.HasPrefix(target, "data:"),
			strings.HasPrefix(target, "/"):
			return match
		}

		return "![" + parts[1] + "](" + base + target + ")"
	})
}

// transformMeta turns a front matter block into a table, so the fields a
// static site generator reads stay visible in the preview. A block that
// holds anything other than `name: value` lines is left alone.
func transformMeta(body string) string {
	if !strings.HasPrefix(body, "---") {
		return body
	}

	rest := body[3:]
	if !strings.Contains(rest, "---") {
		return body
	}

	parts := strings.SplitN(rest, "---", 2)
	rows := []string{"| Name | Value |", "|------|-------|"}

	for _, line := range strings.Split(strings.TrimSpace(parts[0]), "\n") {
		columns := strings.SplitN(line, ":", 2)
		if len(columns) < 2 {
			return body
		}

		name := strings.TrimSpace(columns[0])
		value := strings.TrimSpace(columns[1])
		if name == "image" {
			value = "![](" + strings.Trim(value, `"'`) + ")"
		}

		rows = append(rows, "| "+name+" | "+value+" |")
	}

	return strings.Join(rows, "\n") + "\n---" + parts[1]
}
