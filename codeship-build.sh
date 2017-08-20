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
CI_TAG_AUTO="${CI_TAG_ID}"
if [ -f "build/.date" ]; then
	CI_TAG_AUTO="$(echo ${CI_TAG_ID} | awk -F'.' '{print $1 "." $2}').$(<build/.date)"
fi

make -e CI_TAG_ID=${CI_TAG_ID} \
     -e CI_TAG_AUTO=${CI_TAG_AUTO} \
     -e CI_COMMIT_ID=${CI_COMMIT_ID} \
     -e CI_COMMIT_ID_SHORT=${CI_COMMIT_ID_SHORT} "$@"
