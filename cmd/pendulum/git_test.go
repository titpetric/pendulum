package main

import (
	"os"
	"strings"
	"testing"

	"io/ioutil"
)

func TestGit(t *testing.T) {
	// Set up clean git repo in test/ folder
	git := Git{}
	git.exec(strings.Split("rm -rf test", " "))
	os.Mkdir("test", 0777)
	os.Chdir("test")
	git.exec([]string{"git", "init"})

	// Verify empty user settings
	if val := git.UserName(); val != "" {
		t.Error("Expected name=empty, got " + val)
	}
	if val := git.UserEmail(); val != "" {
		t.Error("Expected email=empty, got " + val)
	}

	// Set local repo settings for test
	git.exec([]string{"git", "config", "user.name", "Tit Petric"})
	git.exec([]string{"git", "config", "user.email", "black@scene-si.org"})

	// Verify new user settings
	if val := git.UserName(); val != "Tit Petric" {
		t.Error("Expected name=Tit Petric, got " + val)
	}
	if val := git.UserEmail(); val != "black@scene-si.org" {
		t.Error("Expected email=black@scene-si.org, got " + val)
	}
	os.Chdir("..")

	// Write a file and commit it, check that path is restored to previous cwd.
	ioutil.WriteFile("test/test.txt", []byte("hello world, I am from the future"), 0644)
	git.Filename = "test/test.txt"
	cwd1, _ := os.Getwd()
	_, err := git.Commit()
	cwd2, _ := os.Getwd()
	if err != nil {
		t.Error(err)
	}
	if cwd1 != cwd2 {
		t.Error("Should reset working directory back to root")
	}

	// Check we made one commit
	os.Chdir("test")
	output := git.exec(strings.Split("git log --format=oneline", " "))
	if strings.Contains(output, "\n") {
		t.Errorf("Expected one commit in the git log, got: '%s'", output)
	}
	os.Chdir("..")
}
