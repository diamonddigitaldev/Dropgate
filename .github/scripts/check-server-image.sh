#!/usr/bin/env bash
# Checks a built image of the server, from the repository's root:
#
#   bash .github/scripts/check-server-image.sh <image> [platform]
#
# - The Web UI's core library in the image, public/js/dropgate-core.js, must be
#   server/public/js/dropgate-core.js byte for byte. CI checks that file is
#   core's build.
# - The server's license in the image, LICENSE, must be server/LICENSE byte for
#   byte, and its org.opencontainers.image.licenses label must be the license
#   server/package.json gives.
# - Started as it is, with a port on 127.0.0.1 only, it must answer GET
#   /api/info with server/package.json's version, and its health check must
#   pass. Its entrypoint must have made /app/data and /app/data/uploads, owned
#   by the user the server runs as.
#
# CI runs it on the image it builds on every push, and the release workflow's
# dry run on each platform's image. It pushes and publishes nothing, and the
# container is only reached from this machine.
set -euo pipefail

image=$1
platform=${2:-}
on=()
if [ -n "$platform" ]; then on=(--platform "$platform"); fi
label=${platform:-$image}

copy=$(mktemp)
for file in public/js/dropgate-core.js LICENSE; do
    if ! docker run --rm "${on[@]}" --entrypoint cat "$image" "/app/$file" > "$copy" ||
        ! cmp -s "$copy" "server/$file"; then
        echo "$label: the image's $file isn't server/$file."
        exit 1
    fi
    echo "$label: it carries server/$file as it is."
done

license=$(node -p "require('./server/package.json').license")
labelled=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.licenses"}}' "$image")
if [ "$labelled" != "$license" ]; then
    echo "$label: its org.opencontainers.image.licenses label is $labelled, but server/package.json's license is $license."
    exit 1
fi
echo "$label: its license label is $license, as server/package.json gives it."

version=$(node -p "require('./server/package.json').version")
id=$(docker run -d "${on[@]}" -p 127.0.0.1::52443 "$image")
trap 'docker rm -f "$id" > /dev/null' EXIT
port=$(docker port "$id" 52443/tcp | head -n 1 | sed 's/.*://')

# Under emulation, another platform's image starts more slowly.
info=
for _ in $(seq 1 90); do
    if info=$(curl -sf "http://127.0.0.1:$port/api/info"); then break; fi
    sleep 1
done
if [ -z "$info" ]; then
    echo "$label: GET /api/info never answered. The container's log:"
    docker logs "$id" 2>&1 | tail -n 40
    exit 1
fi
answered=$(printf '%s' "$info" | node -e 'let s = ""; process.stdin.on("data", (d) => { s += d; }).on("end", () => console.log(JSON.parse(s).version))')
if [ "$answered" != "$version" ]; then
    echo "$label: GET /api/info gives version $answered, but server/package.json has $version."
    exit 1
fi
echo "$label: it starts, and GET /api/info gives version $version."

# The Dockerfile's health check runs every 30 s, after a 15 s start period.
health=
for _ in $(seq 1 120); do
    health=$(docker inspect --format '{{.State.Health.Status}}' "$id")
    if [ "$health" != starting ]; then break; fi
    sleep 1
done
if [ "$health" != healthy ]; then
    echo "$label: its health check says $health."
    docker inspect --format '{{json .State.Health}}' "$id"
    exit 1
fi
echo "$label: its health check passes."

# The entrypoint makes the folders the server writes to, and gives them to dropgate.
for dir in /app/data /app/data/uploads; do
    owner=$(docker exec "$id" stat -c '%U' "$dir" 2> /dev/null || echo 'no one (it is missing)')
    if [ "$owner" != dropgate ]; then
        echo "$label: $dir belongs to $owner, not dropgate."
        exit 1
    fi
done
echo "$label: /app/data and its uploads/ belong to dropgate, the user the server runs as."
