package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Git commits a saved file where the folder is a git repository. A folder
// that is not one, or a git without a configured identity, saves the file
// and says nothing.
type Git struct {
	Filename string
}

func (r *Git) Commit() (string, error) {
	// Every command runs with cmd.Dir set: the server answers requests in
	// parallel, and a chdir moves the ground under all of them.
	folder := filepath.Dir(r.Filename)

	if r.exec(folder, "git", "rev-parse", "--is-inside-work-tree") != "true" {
		return "", nil
	}

	name := r.exec(folder, "git", "config", "user.name")
	email := r.exec(folder, "git", "config", "user.email")
	if name == "" || email == "" {
		return "", nil
	}

	hostname, _ := os.Hostname()
	message := fmt.Sprintf("Edited with Pendulum@%s on %s", hostname, time.Now().Format(time.UnixDate))

	added := r.exec(folder, "git", "add", filepath.Base(r.Filename))
	committed := r.exec(folder, "git", "commit", "-m", message)

	return strings.TrimSpace(added + "\n" + committed), nil
}

func (r *Git) exec(dir, name string, args ...string) string {
	command := exec.Command(name, args...)
	command.Dir = dir

	output, err := command.Output()
	if err != nil {
		return ""
	}

	return strings.TrimSpace(string(output))
}
