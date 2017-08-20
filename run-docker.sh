#!/bin/bash
docker run --name pendulum --restart=always -p 8080:8080 -d -v $(pwd):/app -w /app alpine:3.5 ./pendulum -port 8080
