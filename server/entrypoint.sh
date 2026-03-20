#!/bin/sh
# Create uploads directory if it doesn't exist (runs after volume mount)
mkdir -p /usr/src/app/uploads/db
chown -R dropgate:dropgate /usr/src/app/uploads
exec su-exec dropgate "$@"
