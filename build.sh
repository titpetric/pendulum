#!/bin/bash
docker run --rm -it -e CGO_ENABLED=0 -v `pwd`:/go/src/app -w /go/src/app golang:1.8-alpine go build -o pendulum *.go
