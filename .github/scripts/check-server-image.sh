#!/usr/bin/env bash
# Checks a built image of the server, from the repository's root:
#
#   bash .github/scripts/check-server-image.sh <image> [platform]
#
# - The Web UI's core library in the image, public/js/dropgate-core.js, must be
#   server/public/js/dropgate-core.js byte for byte. CI checks that file is
#   core's build.
# - Started as it is, with a port on 127.0.0.1 only, it must answer GET
#   /api/info with server/package.json's version, and its health check must
#   pass.
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
docker run --rm "${on[@]}" --entrypoint cat "$image" /usr/src/app/public/js/dropgate-core.js > "$copy"
if ! cmp -s "$copy" server/public/js/dropgate-core.js; then
    echo "$label: the image's public/js/dropgate-core.js isn't server/public/js/dropgate-core.js."
    exit 1
fi
echo "$label: it carries server/public/js/dropgate-core.js as it is."

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
