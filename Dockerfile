FROM alpine:3.5

MAINTAINER Tit Petric <black@scene-si.org>

ARG GITVERSION=development
ARG GITTAG=development
ENV GITVERSION=${GITVERSION} GITTAG=${GITTAG}

ADD ./build/pendulum-linux-amd64 /app/pendulum

WORKDIR /app

ENTRYPOINT ["/app/pendulum"]
