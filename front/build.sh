#!/bin/bash
cd src
if [ ! -d "node_modules" ]; then
	yarn install
	npm rebuild node-sass
fi
set -e
yarn lint
yarn build
rsync -a --del src/api/ dist/api/
set +e
cd ..
find src/dist/ -name '*.gz' -delete
find src/dist/ -name '*.js' | xargs gzip -k
find src/dist/ -name '*.css' | xargs gzip -k
find src/dist/ -name '*.html' | xargs gzip -k
echo "Done."