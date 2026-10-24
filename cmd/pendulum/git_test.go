package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestGitCommit(t *testing.T) {
	folder := t.TempDir()
	file := filepath.Join(folder, "test.txt")

	if err := os.WriteFile(file, []byte("hello world, I am from the future"), 0o644); err != nil {
		t.Fatal(err)
	}

	git := Git{Filename: file}

	// A folder that is not a repository saves and says nothing.
	if log, err := git.Commit(); err != nil || log != "" {
		t.Errorf("outside a repository: log=%q err=%v", log, err)
	}

	gitRun(t, folder, "git", "init")

	// A repository with no identity configured is left alone: a commit
	// would be attributed to whoever the machine guesses.
	if log, err := git.Commit(); err != nil || log != "" {
		t.Errorf("without an identity: log=%q err=%v", log, err)
	}

	gitRun(t, folder, "git", "config", "user.name", "Tit Petric")
	gitRun(t, folder, "git", "config", "user.email", "black@scene-si.org")

	if _, err := git.Commit(); err != nil {
		t.Fatal(err)
	}

	log := gitOutput(t, folder, "git", "log", "--format=oneline")
	if strings.Count(log, "\n") != 0 || log == "" {
		t.Errorf("expected one commit, got %q", log)
	}
	if !strings.Contains(log, "Edited with Pendulum@") {
		t.Errorf("expected the pendulum message, got %q", log)
	}
}

func gitRun(t *testing.T, dir, name string, args ...string) {
	t.Helper()

	command := exec.Command(name, args...)
	command.Dir = dir
	if out, err := command.CombinedOutput(); err != nil {
		t.Fatalf("%s %s: %v: %s", name, strings.Join(args, " "), err, out)
	}
}

func gitOutput(t *testing.T, dir, name string, args ...string) string {
	t.Helper()

	command := exec.Command(name, args...)
	command.Dir = dir
	out, err := command.Output()
	if err != nil {
		t.Fatalf("%s %s: %v", name, strings.Join(args, " "), err)
	}

	return strings.TrimSpace(string(out))
}
