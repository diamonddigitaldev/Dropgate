#!/bin/sh
# Create the data folders if they don't exist, then drop to dropgate.
# /app/data holds everything the server keeps: its uploads, in data/uploads/, and its own data.
mkdir -p /app/data/uploads/db /app/data/uploads/objects
chown -R dropgate:dropgate /app/data
exec su-exec dropgate "$@"
