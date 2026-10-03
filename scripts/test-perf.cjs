#!/usr/bin/env node
// Bundle budget — the part of the performance gate that needs a build.
//
// Hot-path timings (parsing, queue loop, UI responsiveness) live in
// src/__tests__/perf.test.ts so they run in vitest and in CI on every push.
// This script only checks the build output's size, because that is the one
// measurement vitest cannot do.
//
// Usage: npm run build && node scripts/test-perf.cjs
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist", "assets");

// Budgets are baseline-derived (+≈10% headroom) so a real regression trips
// them, not an arbitrary round number. Measured on the pre-change build:
//   largest chunk 233 KB · total JS 654 KB · total CSS 169 KB.
const BUDGET = {
  chunkKb: 260, // no single JS chunk
  totalJsKb: 720, // all JS combined
  cssKb: 190, // Tailwind v4 emits one large sheet
};

function fail(msg) {
  console.error("❌ " + msg);
  process.exit(1);
}

if (!fs.existsSync(DIST)) {
  fail("dist/assets not found — run `npm run build` first.");
}

const files = fs
  .readdirSync(DIST)
  .filter((f) => f.endsWith(".js") || f.endsWith(".css"))
  .map((f) => ({ name: f, kb: Math.round(fs.statSync(path.join(DIST, f)).size / 1024) }))
  .sort((a, b) => b.kb - a.kb);

const js = files.filter((f) => f.name.endsWith(".js"));
const css = files.filter((f) => f.name.endsWith(".css"));
const totalJsKb = js.reduce((s, f) => s + f.kb, 0);
const totalCssKb = css.reduce((s, f) => s + f.kb, 0);

console.log("── bundle ──");
for (const f of files.slice(0, 6)) console.log(`   ${f.kb.toString().padStart(5)} KB  ${f.name}`);
console.log(`   ── ${totalJsKb} KB JS + ${totalCssKb} KB CSS across ${files.length} files\n`);

if (js[0].kb > BUDGET.chunkKb) {
  fail(`largest chunk ${js[0].name} is ${js[0].kb} KB (budget ${BUDGET.chunkKb} KB)`);
}
if (totalJsKb > BUDGET.totalJsKb) {
  fail(`total JS ${totalJsKb} KB exceeds budget ${BUDGET.totalJsKb} KB`);
}
if (totalCssKb > BUDGET.cssKb) {
  fail(`total CSS ${totalCssKb} KB exceeds budget ${BUDGET.cssKb} KB`);
}

console.log(
  `✅ bundle within budget — largest ${js[0].kb} KB ≤ ${BUDGET.chunkKb} KB, ` +
    `JS ${totalJsKb} KB ≤ ${BUDGET.totalJsKb} KB, CSS ${totalCssKb} KB ≤ ${BUDGET.cssKb} KB`,
);