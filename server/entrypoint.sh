#!/bin/sh
# Create the folders the server writes to, if they don't exist, then drop to dropgate.
# uploads/ holds uploads; data/ holds the server's own data, outside uploads/.
mkdir -p /usr/src/app/uploads/db /usr/src/app/uploads/objects /usr/src/app/data
chown -R dropgate:dropgate /usr/src/app/uploads /usr/src/app/data
exec su-exec dropgate "$@"
