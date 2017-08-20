#!/bin/bash
set -e

## Get git commit ID
CI_COMMIT_ID=${CI_COMMIT_ID:-$(git rev-list HEAD --max-count=1)}
CI_COMMIT_ID_SHORT=${CI_COMMIT_ID:0:7}

## Get latest tag ID
CI_TAG_ID=$(git tag | tail -n 1)
if [ -z "${CI_TAG_ID}" ]; then
	CI_TAG_ID="v0.0.0";
fi
CI_TAG_AUTO="$(echo ${CI_TAG_ID} | awk -F'.' '{print $1 "." $2}').$(<build/.date)"

## Login to docker hub on release action
if [ ! -f "/root/.docker/config.json" ]; then
	docker login -u $DOCKER_REGISTRY_USERNAME -p $DOCKER_REGISTRY_PASSWORD
fi

## Release to Docker Hub
docker tag titpetric/pendulum titpetric/pendulum:${CI_COMMIT_ID_SHORT}
docker push titpetric/pendulum:${CI_COMMIT_ID_SHORT}
docker push titpetric/pendulum:latest
