# Start with the Python Alpine image as the build image
FROM python:3-alpine AS build

# Install build-base and libffi headers
RUN apk update && \
    apk add build-base libffi-dev git

# Add the required packages, disabling cache to reduce the size of the image
COPY ./requirements.txt /requirements.txt
RUN pip install --no-cache-dir --prefix=/install -r /requirements.txt

# Start with a fresh image after installing the necessary Python packages
FROM python:3-alpine

# Copy the python packages only from the build stage
COPY --from=build /install /usr/local

# Create an unprivileged runtime user and tools needed by the entrypoint
RUN apk add --no-cache su-exec \
    && addgroup -S app \
    && adduser -S -G app app \
    && mkdir -p /var/cache/converter-art \
    && chown app:app /var/cache/converter-art

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Entrypoint runs as root to fix volume ownership, then drops to app
ENTRYPOINT ["/entrypoint.sh"]

# Set the default command to run uvicorn with a socket connection
CMD [ "uvicorn", "app.index:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers" ]
