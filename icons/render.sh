#!/bin/sh
# Renders the app's icons into public/ from the drawings here. Needs rsvg-convert (brew install librsvg).
set -e
cd "$(dirname "$0")"
public=../public

cp icon.svg "$public/favicon.svg"
# On the loading and start screens
cp logo.svg "$public/logo.svg"
rsvg-convert -w 192 -h 192 icon.svg -o "$public/icon-192.png"
rsvg-convert -w 512 -h 512 icon.svg -o "$public/icon-512.png"
# For launchers that cut their own shape out of the icon, like Android's and Chrome's on macOS
rsvg-convert -w 512 -h 512 icon-maskable.svg -o "$public/icon-maskable-512.png"
# For Safari's Add to Dock and iOS, which round the corners themselves
rsvg-convert -w 180 -h 180 icon-maskable.svg -o "$public/apple-touch-icon.png"
