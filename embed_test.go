package pendulum_test

import (
	"io/fs"
	"testing"

	"github.com/titpetric/pendulum"
)

// TestFront holds the page the binary serves.
func TestFront(t *testing.T) {
	t.Parallel()

	if _, err := fs.Stat(pendulum.Front(), "index.html"); err != nil {
		t.Fatal(err)
	}
}

// TestMDEdit holds the editor bundle the page loads.
func TestMDEdit(t *testing.T) {
	t.Parallel()

	if _, err := fs.Stat(pendulum.MDEdit(), "mdedit.min.js"); err != nil {
		t.Fatal(err)
	}
}
