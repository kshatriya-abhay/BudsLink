#!/bin/bash
# Render every page of the demo gallery to PNGs, for reviewing all models'
# panels at once. Needs the plugin running in demo mode with the gallery on:
#   omarchy-shell kshatriya-abhay.buds demo on
#
#   omarchy/dev/gallery-snapshots.sh [out-dir]
#
# Default out-dir: ~/.local/state/omarchy-buds/snapshots. The panel renders
# itself (Qt grabToImage), so this never reads the screen.
set -euo pipefail

id=kshatriya-abhay.buds
out="${1:-$HOME/.local/state/omarchy-buds/snapshots}"
mkdir -p "$out"
rm -f "$out"/page-*.png

ipc() { omarchy-shell "$id" "$@"; }

pages=$(ipc status | jq -r '.gallery.pages')
[[ $(ipc status | jq -r '.demo') == true ]] || { echo "demo mode is off: omarchy-shell $id demo on" >&2; exit 1; }
ipc gallery on >/dev/null
ipc open >/dev/null
sleep 1

for ((p = 1; p <= pages; p++)); do
  ipc page "$p" >/dev/null
  sleep 0.6
  raw="$out/.raw-$p.png"
  bg=$(ipc snapshot "$raw")
  for _ in $(seq 1 25); do [[ -s $raw ]] && break; sleep 0.2; done
  [[ -s $raw ]] || { echo "page $p: no snapshot (is the panel open?)" >&2; continue; }
  magick "$raw" -background "$bg" -flatten "$out/page-$(printf %02d "$p").png"
  rm -f "$raw"
done

ipc page 1 >/dev/null
echo "$pages pages in $out"
