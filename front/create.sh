#!/bin/bash
if [ -d "src" ]; then
	echo "A project already exists in the src/ folder"
	exit 1
fi
if [ ! -d "node_modules" ]; then
	npm i vue-cli
fi
node_modules/.bin/vue init webpack src
rm -rf node_modules package.json yarn.lock
cd src
npm install
npm i axios jsonp --save
npm i sass-loader node-sass --dev
npm i bootstrap@4.0.0-alpha.6 --dev
