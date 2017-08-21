#!/bin/bash
if [ ! -d "vendor/github.com/elazarl/go-bindata-assetfs" ]; then
	gvt fetch github.com/elazarl/go-bindata-assetfs
fi
go generate
docker run --rm -it -e CGO_ENABLED=0 -v `pwd`:/go/src/app -w /go/src/app golang:1.8-alpine go build -o pendulum *.go
