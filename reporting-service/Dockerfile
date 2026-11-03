FROM golang:1.22-alpine AS build
ENV CGO_ENABLED=0
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Vet and test as part of the build so a broken service never produces an image.
RUN go vet ./... && go test ./... && \
    go build -trimpath -ldflags="-s -w" -o /out/reporting-service ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/reporting-service /reporting-service
EXPOSE 8080
ENTRYPOINT ["/reporting-service"]
