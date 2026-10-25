BINARY  := pendulum
LDFLAGS := -s -w
MDEDIT  ?= ../mdedit

# The image this repository publishes, and the tag a release carries. VERSION
# defaults to the commit being built, so `make release` from a clean checkout
# names what it shipped; pass one to tag a version: `make release VERSION=1.2.0`.
IMAGE    ?= titpetric/pendulum
VERSION  ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
PLATFORMS ?= linux/amd64,linux/arm64

.PHONY: all build test check run docker docker-test docker-push release release-binaries mdedit clean

all: test build

build:
	CGO_ENABLED=0 go build -trimpath -ldflags '$(LDFLAGS)' -o build/$(BINARY) ./cmd/pendulum

test:
	go vet ./...
	go test ./...

# The editor screen in a browser: the check builds the binary, serves a
# folder it writes itself, and drives chromium over it. PLAYWRIGHT points at
# the module where it is not installed here, CHROMIUM at the browser.
check:
	node tests/browser.mjs
	node tests/issues.mjs

run:
	go run ./cmd/pendulum

docker:
	docker build --rm -t $(IMAGE):$(VERSION) -t $(IMAGE):latest .

# What the image has to answer before it is pushed: it starts, it serves the
# folder mounted into it, and the version it reports is the one built.
docker-test: docker
	docker run --rm $(IMAGE):$(VERSION) -help 2>&1 | grep -q autosave
	docker run --rm -d --name $(BINARY)-check -p 18099:8080 -v $(CURDIR)/tests/fixture:/app/contents $(IMAGE):$(VERSION)
	@for i in $$(seq 1 50); do \
		curl -sf http://127.0.0.1:18099/api/list/ >/dev/null && break; \
		sleep 0.2; \
	done; \
	status=0; \
	curl -sf http://127.0.0.1:18099/api/list/ | grep -q "hello.md" || status=1; \
	curl -sf http://127.0.0.1:18099/ | grep -q "Pendulum" || status=1; \
	docker rm -f $(BINARY)-check >/dev/null; \
	exit $$status
	@echo "the image serves the folder it is given"

docker-push: docker-test
	docker push $(IMAGE):$(VERSION)
	docker push $(IMAGE):latest

# The whole of a release: the tests, the image, what the image has to answer,
# and the push. Nothing reaches the registry that has not passed the two
# gates above it.
release: test check docker-push
	@echo "pushed $(IMAGE):$(VERSION) and $(IMAGE):latest"

# The release matrix the binaries on the releases page are built from.
release-binaries:
	@rm -rf build && mkdir -p build
	@for os in linux darwin windows; do \
		for arch in amd64 arm64; do \
			out=build/$(BINARY)-$$os-$$arch; \
			[ $$os = windows ] && out=$$out.exe; \
			echo $$out; \
			GOOS=$$os GOARCH=$$arch CGO_ENABLED=0 \
				go build -trimpath -ldflags '$(LDFLAGS)' -o $$out ./cmd/pendulum || exit 1; \
		done; \
	done
	@find build -type f

# Refresh the editor from a checkout of github.com/titpetric/mdedit.
mdedit:
	cp $(MDEDIT)/dist/mdedit.min.js $(MDEDIT)/dist/mdedit.min.css front/vendor/mdedit/

clean:
	rm -rf build
