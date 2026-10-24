// Pendulum edits the markdown and text files under a folder, in a browser,
// and commits every save when the folder is a git repository.
//
//	pendulum                          # the current folder, on :8080
//	pendulum -addr :8081 docs         # another folder, another port
//	pendulum -ext jpg,png             # only those two extensions upload
package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/titpetric/pendulum"
)

func main() {
	var (
		addr     = flag.String("addr", ":8080", "address for the server")
		contents = flag.String("contents", ".", "folder to edit")
		ext      = flag.String("ext", strings.Join(DefaultExtensions, ","), "extensions an upload may use")
	)
	flag.Parse()

	// The folder is also accepted as a bare argument, which is the shortest
	// way to start: `pendulum docs`.
	if folder := flag.Arg(0); folder != "" {
		*contents = folder
	}

	log.SetOutput(os.Stdout)
	log.SetFlags(log.Ltime)

	if err := run(*addr, *contents, *ext); err != nil {
		log.Fatal(err)
	}
}

func run(addr, contents, ext string) error {
	root, err := filepath.Abs(contents)
	if err != nil {
		return err
	}
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		return errors.New("no such folder: " + contents)
	}

	uploads, err := NewUploads(root, ext)
	if err != nil {
		return err
	}

	api := &API{
		Root:     root,
		Uploads:  uploads,
		Frontend: pendulum.Front(),
	}

	server := &http.Server{
		Addr:              addr,
		Handler:           logging(Routes(api)),
		ReadHeaderTimeout: 5 * time.Second,
	}

	// Ctrl-C stops the server and lets what is in flight finish.
	stopping := make(chan os.Signal, 1)
	signal.Notify(stopping, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-stopping
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()

	log.Printf("editing %s", root)
	log.Printf("uploads land in assets/ beside the file, as %s<ulid>.<ext>", uploadPrefix)
	log.Printf("extensions: %s", strings.Join(uploads.Extensions, ", "))
	log.Printf("listening on http://localhost%s", addr)

	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}

	return nil
}

// logging reports one line per request, so the terminal shows what the
// browser requested.
func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(started).Round(time.Millisecond))
	})
}
