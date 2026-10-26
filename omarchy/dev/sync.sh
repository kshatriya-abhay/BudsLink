#!/bin/bash
# Copy this working tree into Omarchy's plugin folder for testing, then
# validate it and ask the shell to rescan. Symlinks aren't allowed there,
# so this is a copy; run it again after every change.
#
#   omarchy/dev/sync.sh             copy, validate, rescan
#   omarchy/dev/sync.sh --restart   ...and restart the shell (needed after
#                                   changes to Service.qml, a keepLoaded service)
set -euo pipefail

repo="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)"
id="$(jq -r .id "$repo/manifest.json")"
dest="$HOME/.config/omarchy/plugins/$id"

mkdir -p "$dest"
rsync -a --delete \
  --exclude .git --exclude po --exclude subprojects --exclude build-aux \
  --exclude 'data/screenshots' --exclude 'CLAUDE.md' \
  "$repo/" "$dest/"

omarchy plugin validate "$dest"
omarchy-shell shell rescanPlugins >/dev/null
echo "synced $id -> $dest"

if [[ ${1:-} == --restart ]]; then
  omarchy restart shell
fi
