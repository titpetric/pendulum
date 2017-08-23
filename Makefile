all:
	@echo 'Usage: make <prepare|build-go|build-docker>'

build-go:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o    build/pendulum-linux-amd64 *.go
	CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -o   build/pendulum-darwin-amd64 *.go
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o  build/pendulum-windows-amd64.exe *.go
	CGO_ENABLED=0 GOOS=linux GOARCH=386 go build -o      build/pendulum-linux-386 *.go
	CGO_ENABLED=0 GOOS=darwin GOARCH=386 go build -o     build/pendulum-darwin-386 *.go
	CGO_ENABLED=0 GOOS=windows GOARCH=386 go build -o    build/pendulum-windows-386.exe *.go
	cd build && gzip pendulum* && cd ..
	@echo "Build finished"

build-docker:
	docker build --rm -t titpetric/pendulum --build-arg GITVERSION=${CI_COMMIT_ID} --build-arg GITTAG=${CI_TAG_AUTO} .

prepare:
	@rm -rf build && mkdir build
	@date +"%y%m%d-%H%M" > build/.date
	@echo "Build folder prepared"
	cd front && ./build.sh && cd ..
	go generate

test:
	go test

.PHONY: all test build-docker prepare