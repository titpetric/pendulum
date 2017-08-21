all:
	@echo 'Usage: make <prepare|build-go|build-docker>'

build-go: build/pendulum build/pendulum.exe
	@echo "Build finished"

build/pendulum:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o build/pendulum *.go
	cd build && tar -zcvf pendulum_linux_64bit.tgz pendulum && cd ..

build/pendulum.exe:
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o build/pendulum.exe *.go
	cd build && tar -zcvf pendulum_windows_64bit.tgz pendulum.exe && cd ..

build-docker:
	cd front && ./build.sh
	docker build --rm -t titpetric/pendulum --build-arg GITVERSION=${CI_COMMIT_ID} --build-arg GITTAG=${CI_TAG_AUTO} .

prepare:
	@rm -rf build && mkdir build
	@date +"%y%m%d-%H%M" > build/.date
	@echo "Build folder prepared"
	go generate

.PHONY: all build-docker prepare