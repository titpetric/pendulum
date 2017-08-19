#!/bin/bash
cd src
if [ ! -d "node_modules" ]; then
	npm install
fi
set -e
npm run lint
npm run build
rsync -a --del src/api/ dist/api/
set +e
cd ..
find src/dist/ -name '*.gz' -delete
find src/dist/ -name '*.js' | xargs gzip -k
find src/dist/ -name '*.css' | xargs gzip -k
find src/dist/ -name '*.html' | xargs gzip -k
echo "Done."