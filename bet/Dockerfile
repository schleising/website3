# Start with the golang image
FROM golang:latest AS builder

# Set the Current Working Directory inside the container
WORKDIR /app

# Copy go mod and sum files
COPY src/* /app/

# Build the Go app
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -a -o go-bet-server .

# Start with a fresh image
FROM alpine:latest

# Update and upgrade the image
RUN apk update && apk upgrade

# Copy the GeoLite2 City database
COPY GeoLite2-City/GeoLite2-City.mmdb /app/GeoLite2-City.mmdb

# Copy the Pre-built binary file from the previous stage
COPY --from=builder /app/go-bet-server /app/go-bet-server

# Command to run the executable
ENTRYPOINT [ "/app/go-bet-server" ]
