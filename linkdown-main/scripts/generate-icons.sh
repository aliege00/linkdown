#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# VidFetch — PWA Icon Generator
# ─────────────────────────────────────────────────────────────
# Generates PNG icons from the SVG source for the PWA manifest.
# Requires: ImageMagick (convert) or Inkscape or sharp
# ─────────────────────────────────────────────────────────────

set -e

ICON_SVG="public/icon.svg"
OUT_DIR="public"

echo "Generating PWA icons from ${ICON_SVG}..."

# Try sharp (Node.js)
if command -v npx &>/dev/null && npx --yes sharp --version &>/dev/null 2>&1; then
  echo "Using sharp..."
  npx sharp-cli --input "$ICON_SVG" --output "${OUT_DIR}/icon-192.png" --resize 192 2>/dev/null || true
  npx sharp-cli --input "$ICON_SVG" --output "${OUT_DIR}/icon-512.png" --resize 512 2>/dev/null || true
fi

# Try ImageMagick
if command -v convert &>/dev/null; then
  echo "Using ImageMagick..."
  convert -background none -resize 192x192 "$ICON_SVG" "${OUT_DIR}/icon-192.png" 2>/dev/null || true
  convert -background none -resize 512x512 "$ICON_SVG" "${OUT_DIR}/icon-512.png" 2>/dev/null || true
  echo "✓ Icons generated: icon-192.png, icon-512.png"
  exit 0
fi

# Fallback: generate minimal placeholder PNGs via a Node.js script
echo "No image tools found. Creating placeholder icons via Node.js..."
node -e "
const fs = require('fs');
function createMinimalPNG(size) {
  // Minimal valid PNG: 1x1 pixel transparent
  const png = Buffer.from([
    0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A, // PNG signature
    0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52, // IHDR chunk
    0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01, // 1x1 pixel
    0x08,0x06,0x00,0x00,0x00,0x1F,0x15,0xC4,0x89, // RGBA
    0x00,0x00,0x00,0x0A,0x49,0x44,0x41,0x54,
    0x78,0x9C,0x62,0x00,0x00,0x00,0x02,0x00,0x01,
    0xE5,0x27,0xDE,0xFC,0x00,0x00,0x00,0x00,0x49,
    0x45,0x4E,0x44,0xAE,0x42,0x60,0x82 // IEND
  ]);
  return png;
}
fs.writeFileSync('${OUT_DIR}/icon-192.png', createMinimalPNG(192));
fs.writeFileSync('${OUT_DIR}/icon-512.png', createMinimalPNG(512));
console.log('✓ Placeholder icons created. Replace with proper icons later.');
"
