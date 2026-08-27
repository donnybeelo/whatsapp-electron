#!/bin/sh
# flatpak reads its Version from the metainfo, not from package.json, so stamp
# a copy at build time rather than letting the checked-in file drift. Written
# to dist/ so builds never dirty the tree.
set -e
cd "$(dirname "$0")/.."
version=$(node -p "require('./package.json').version")
mkdir -p dist
sed -e "s|<release version=\"[^\"]*\" date=\"[^\"]*\"/>|<release version=\"$version\" date=\"$(date +%F)\"/>|" \
	assets/net.donnybeelo.WhatsApp.metainfo.xml > dist/net.donnybeelo.WhatsApp.metainfo.xml
grep -q "version=\"$version\"" dist/net.donnybeelo.WhatsApp.metainfo.xml \
	|| { echo "failed to stamp version $version into the metainfo" >&2; exit 1; }
