#!/usr/bin/env node
/**
 * PWA Icon Generator
 * Generates proper PNG icons from the SVG source.
 *
 * Usage: node scripts/generate-icons.mjs
 *
 * Requires: sharp (or falls back to simple SVGs for the manifest)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const svgPath = resolve(root, "public/icon.svg");
const outDir = resolve(root, "public");

console.log("📦 Generating PWA icons...");

// Try sharp
try {
  const sharp = (await import("sharp")).default;
  const svg = readFileSync(svgPath);

  await sharp(svg).resize(192, 192).png().toFile(resolve(outDir, "icon-192.png"));
  await sharp(svg).resize(512, 512).png().toFile(resolve(outDir, "icon-512.png"));

  console.log("✅ Generated icon-192.png and icon-512.png via sharp");
} catch {
  // sharp not available — embed the SVG directly as a fallback
  console.log("⚠️  sharp not found. Embedding SVG icons for development.");
  const svg = readFileSync(svgPath, "utf-8");

  // For PWABuilder, just reference the SVG — it handles vector icons
  writeFileSync(resolve(outDir, "icon-192.png"), svg);
  writeFileSync(resolve(outDir, "icon-512.png"), svg);

  console.log("ℹ️  For production icons, install sharp: npm install -D sharp");
}
