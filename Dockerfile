FROM golang:1.26-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags '-s -w' -o /pendulum ./cmd/pendulum

FROM alpine:3.22

# git, because a save commits where the folder is a repository.
RUN apk add --no-cache git ca-certificates

COPY --from=build /pendulum /usr/local/bin/pendulum

# The folder to edit is mounted here: `docker run -v $(pwd):/app/contents`.
WORKDIR /app/contents

EXPOSE 8080

ENTRYPOINT ["pendulum"]
