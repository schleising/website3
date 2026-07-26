#!/bin/sh
set -e

# Named volumes are often root-owned; the app user must be able to write posters.
if [ -n "${CONVERTER_ART_CACHE_DIR:-}" ]; then
  mkdir -p "$CONVERTER_ART_CACHE_DIR"
  chown -R app:app "$CONVERTER_ART_CACHE_DIR" 2>/dev/null || true
fi

exec su-exec app "$@"
