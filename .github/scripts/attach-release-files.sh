#!/usr/bin/env bash
# Attaches files to a published release, and checks each one is there as it is:
#
#   bash .github/scripts/attach-release-files.sh <tag> <file>...
#
# The release workflow runs it in each job that attaches files, with GH_TOKEN
# set to a token that can write the repository's contents.
#
# - It never replaces a file the release already has: gh fails instead, and so
#   does the job. To run such a job again, delete its files from the release
#   first.
# - Then each file must be attached, with its size and SHA-256 as GitHub gives
#   them.
set -euo pipefail

if [ $# -lt 2 ]; then
    echo "Usage: bash attach-release-files.sh <tag> <file>..."
    exit 2
fi
tag=$1
shift

gh release upload "$tag" "$@" --repo "$GITHUB_REPOSITORY"

# GitHub works out each file's SHA-256 as it takes it, so this gives it a few
# seconds before deciding one is missing.
missing=()
for _ in $(seq 1 5); do
    assets=$(gh api "repos/$GITHUB_REPOSITORY/releases/tags/$tag" \
        --jq '.assets[] | "\(.name) \(.size) \(.digest) \(.state)"')
    missing=()
    for file in "$@"; do
        expected="$(basename "$file") $(wc -c < "$file" | tr -d ' ') sha256:$(sha256sum "$file" | cut -d' ' -f1) uploaded"
        if [[ $'\n'$assets$'\n' != *$'\n'$expected$'\n'* ]]; then missing+=("$expected"); fi
    done
    if [ ${#missing[@]} -eq 0 ]; then break; fi
    sleep 2
done

if [ ${#missing[@]} -gt 0 ]; then
    echo "These aren't attached to $tag as they are:"
    printf '  %s\n' "${missing[@]}"
    echo "The release has:"
    printf '%s\n' "$assets" | sed 's/^/  /'
    exit 1
fi
echo "Attached to $tag, each with its size and SHA-256:"
for file in "$@"; do
    printf '  %s  %d bytes  sha256 %s\n' "$(basename "$file")" "$(wc -c < "$file")" "$(sha256sum "$file" | cut -d' ' -f1)"
done
