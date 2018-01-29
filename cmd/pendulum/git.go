package main

import (
	"fmt"
	"os"
	"path"
	"strings"
	"time"

	"os/exec"
)

type Git struct {
	Filename string
}

func (r *Git) Commit() (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	err = os.Chdir(path.Dir(r.Filename))
	if err != nil {
		return "", err
	}
	defer os.Chdir(cwd)

	// Don't error out if git isn't configured
	name := r.UserName()
	email := r.UserEmail()
	if name == "" || email == "" {
		return "", nil
	}

	hostname, _ := os.Hostname()
	message := fmt.Sprintf("Edited with Pendulum@%s on %s", hostname, time.Now().Format(time.UnixDate))

	output := r.exec([]string{"git", "add", path.Base(r.Filename)})
	return output + "\n" + r.exec([]string{"git", "commit", "-m", message}), nil
}

func (r *Git) UserName() string {
	return r.exec(strings.Split("git config user.name", " "))
}

func (r *Git) UserEmail() string {
	return r.exec(strings.Split("git config user.email", " "))
}

func (r *Git) exec(cmdArgs []string) string {
	cmdName := cmdArgs[0]
	if cmdOut, err := exec.Command(cmdName, cmdArgs[1:]...).Output(); err == nil {
		return strings.TrimSpace(string(cmdOut))
	}
	return ""
}
