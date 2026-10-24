package main

import (
	"strings"
	"testing"
)

func TestPreviewBase(t *testing.T) {
	for document, want := range map[string]string{
		"/post/stub.md": "/contents/post/stub/",
		"post/stub.md":  "/contents/post/stub/",
		"/README.md":    "/contents/README/",
		"/notes":        "/contents/notes/",
	} {
		if got := PreviewBase(document); got != want {
			t.Errorf("%s: got %q want %q", document, got, want)
		}
	}
}

func TestTransformImages(t *testing.T) {
	body := strings.Join([]string{
		"![](assets/pendulum_01.png)",
		"![alt](images/a.jpg)",
		"![](https://example.com/b.png)",
		"![](/already/absolute.png)",
	}, "\n")

	got := Transform(body, "/post/stub.md")

	for _, want := range []string{
		"![](/contents/post/stub/assets/pendulum_01.png)",
		"![alt](/contents/post/stub/images/a.jpg)",
		"![](https://example.com/b.png)",
		"![](/already/absolute.png)",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
}

func TestTransformConventions(t *testing.T) {
	body := strings.Join([]string{
		"A> an aside",
		"",
		"{pagebreak}",
		"",
		"<!--more-->",
		"",
		"{% asset_img shot.png %}",
		"{% asset_img shot.png \"A title\" %}",
	}, "\n")

	got := Transform(body, "/notes.md")

	for _, want := range []string{
		"> an aside",
		`<hr class="pagebreak"/>`,
		"![](/contents/notes/shot.png)",
		"![A title](/contents/notes/shot.png)",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}

	if strings.Count(got, "pagebreak") != 2 {
		t.Errorf("both markers should become page breaks:\n%s", got)
	}
}

func TestTransformMeta(t *testing.T) {
	body := "---\ntitle: A post\nimage: \"cover.jpg\"\ndate: 2018-03-12 15:40:56\n---\n\nThe body stays.\n"

	got := Transform(body, "/post/stub.md")

	for _, want := range []string{
		"| Name | Value |",
		"| title | A post |",
		"| image | ![](/contents/post/stub/cover.jpg) |",
		// A value holding a colon survives: the split takes the first one.
		"| date | 2018-03-12 15:40:56 |",
		"The body stays.",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
}

func TestTransformMetaLeavesProseAlone(t *testing.T) {
	body := "---\nthis is a horizontal rule, not front matter\n---\n"

	if got := Transform(body, "/notes.md"); got != body {
		t.Errorf("prose should be left alone, got:\n%s", got)
	}
}

func TestRender(t *testing.T) {
	html, err := Render("# Title\n\n| a | b |\n| - | - |\n| 1 | 2 |\n", "/notes.md")
	if err != nil {
		t.Fatal(err)
	}

	for _, want := range []string{"<h1>Title</h1>", "<table>", "<td>1</td>"} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q in:\n%s", want, html)
		}
	}
}

func TestContentCandidates(t *testing.T) {
	// An upload lands in assets/ beside the document, while the preview
	// resolves links against the document's own name: dropping the stem is
	// what connects the two.
	got := contentCandidates("/post/stub/assets/pendulum_01.png")

	if !containsString(got, "/post/assets/pendulum_01.png") {
		t.Errorf("expected the assets path, got %v", got)
	}
	if got[0] != "/post/stub/assets/pendulum_01.png" {
		t.Errorf("the literal path comes first, got %v", got)
	}

	// The layouts the old editor carried: an image beside the post, and one
	// under /images where the post sits under /post.
	if !containsString(contentCandidates("/post/stub/a.jpg"), "/post/a.jpg") {
		t.Error("expected the path beside the post")
	}
	if !containsString(contentCandidates("/post/stub/a.jpg"), "/images/stub/a.jpg") {
		t.Error("expected the /images swap")
	}
}

func containsString(list []string, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}
