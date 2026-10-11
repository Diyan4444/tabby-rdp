#!/bin/sh
# Verify operator-selected installation media before uploading or booting it.
set -eu
image=${1:-}
expected=${2:-}
case "$expected" in *[!a-fA-F0-9]*|'') echo 'image SHA-256 must be 64 hexadecimal characters' >&2; exit 2;; esac
[ ${#expected} -eq 64 ] || { echo 'image SHA-256 must be 64 hexadecimal characters' >&2; exit 2; }
[ -f "$image" ] || { echo "image does not exist: $image" >&2; exit 2; }
if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum -- "$image" | cut -d ' ' -f 1)
else
    actual=$(shasum -a 256 -- "$image" | cut -d ' ' -f 1)
fi
expected=$(printf '%s' "$expected" | tr A-F a-f)
[ "$actual" = "$expected" ] || { echo "image SHA-256 mismatch: $image" >&2; exit 1; }
