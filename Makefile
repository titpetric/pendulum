BINARY  := pendulum
LDFLAGS := -s -w
MDEDIT  ?= ../mdedit

.PHONY: all build test run docker release mdedit clean

all: test build

build:
	CGO_ENABLED=0 go build -trimpath -ldflags '$(LDFLAGS)' -o build/$(BINARY) ./cmd/pendulum

test:
	go vet ./...
	go test ./...

run:
	go run ./cmd/pendulum

docker:
	docker build --rm -t titpetric/$(BINARY) .

# The release matrix the binaries on the releases page are built from.
release:
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
