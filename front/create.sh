#!/bin/bash
if [ -d "src" ]; then
	echo "A project already exists in the src/ folder"
	exit 1
fi
if [ ! -d "node_modules" ]; then
	yarn add vue-cli
fi
node_modules/.bin/vue init webpack src
rm -rf node_modules package.json yarn.lock
cd src
yarn install
yarn add axios jsonp --save
yarn add sass-loader node-sass --dev
yarn add bootstrap@4.0.0-alpha.6 --dev
npm rebuild node-saas