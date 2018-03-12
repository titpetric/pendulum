FROM golang:1.10-alpine

MAINTAINER Tit Petric <black@scene-si.org>

RUN	apk --update add bash gzip make docker nodejs nodejs-npm rsync git && \
	go get -u github.com/aktau/github-release && \
	go get -u github.com/jteeuwen/go-bindata/...

WORKDIR /go/src/github.com/titpetric/pendulum
