#!/bin/bash
docker build --rm -t pendulum-build -f Dockerfile.build .
docker run --rm -it -v $PWD:/go/src/github.com/titpetric/pendulum pendulum-build ./build.sh
docker rmi pendulum-build