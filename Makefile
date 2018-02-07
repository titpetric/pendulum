all:
	@echo 'Usage: make <prepare|build-go|build-docker>'

build-go:
	./build.sh
	cd build && gzip -k pendulum* && cd ..
	@echo "Build finished"

build-docker:
	docker build --rm -t titpetric/pendulum --build-arg GITVERSION=${CI_COMMIT_ID} --build-arg GITTAG=${CI_TAG_AUTO} .

prepare:
	@rm -rf build && mkdir build
	@date +"%y%m%d-%H%M" > build/.date
	@echo "Build folder prepared"
	cd front && ./build.sh && cd ..
	go generate

.PHONY: all test build-docker prepare