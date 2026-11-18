#!/bin/sh
# Builds the downloadable extensions into apps/web/public/downloads (served by the web app).
set -e
cd "$(dirname "$0")"
OUT=../apps/web/public/downloads
mkdir -p "$OUT"
rm -f "$OUT/pingsell-wordpress.zip" "$OUT/pingsell-prestashop.zip"
(cd wordpress && zip -qr "../$OUT/pingsell-wordpress.zip" pingsell -x '*.DS_Store')
(cd prestashop && zip -qr "../$OUT/pingsell-prestashop.zip" pingsell -x '*.DS_Store')
ls -l "$OUT"
