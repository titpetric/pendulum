#!/bin/bash
docker rm -f pendulum
docker run --name pendulum --restart=always -p 8080:8080 -d -v $(pwd)/contents:/app/contents titpetric/pendulum -port 8080
