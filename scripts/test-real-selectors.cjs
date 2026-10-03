#!/usr/bin/env node
// REAL selector verification — runs every format chain the app can send to
// yt-dlp (default "data" 480p, pinned 720p/1080p, and "best") against a REAL
// remote video file, exactly like the on-device/APK engine does, and asserts a
// non-empty file lands on disk.
//
// Why this matters: a chain that resolves nothing makes yt-dlp exit non-zero
// with "Requested format is not available" — the download never starts. That
// is exactly what happened for DIRECT media links (a plain https://…/clip.mp4
// exposes one format with no height and no codec info, so every
// `[height<=…]`/`[acodec!=none]` term rejected it).
//
// The chains are read from the app source at runtime (no copy-paste drift),
// then handed to the real engine.
//
// Usage: node scripts/test-real-selectors.cjs
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const DEFAULT_URL =
  "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4";
const TARGET = process.env.TEST_URL || DEFAULT_URL;
const YTDLP = process.env.YTDLP_BIN || "yt-dlp";

function fail(msg) {
  console.error("❌ " + msg);
  process.exit(1);
}

/** Pull the chains straight out of the app source so they cannot drift. */
function readChains() {
  const script =
    "import { mp4FormatWithHeight, MP4_FORMAT_SELECTOR, MP3_FORMAT_SELECTOR } from './src/lib/format-enforce.ts';" +
    "import { selectorForMode } from './src/lib/download-modes.ts';" +
    "console.log(JSON.stringify({" +
    "data: mp4FormatWithHeight(480)," +
    "pinned720: mp4FormatWithHeight(720)," +
    "pinned1080: mp4FormatWithHeight(1080)," +
    "best: MP4_FORMAT_SELECTOR," +
    "audio: MP3_FORMAT_SELECTOR," +
    "dataParity: selectorForMode('data') === mp4FormatWithHeight(480)," +
    "}))";
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { cwd: path.join(__dirname, ".."), encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(out.trim().split("\n").pop());
}

const chains = readChains();
if (!chains.dataParity) {
  fail("selectorForMode('data') !== mp4FormatWithHeight(480) — the UI chip and the chain it sends disagree");
}
console.log(`target: ${TARGET}\n`);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "vidfetch-sel-"));
const results = [];

for (const [name, format] of Object.entries(chains)) {
  if (name === "dataParity" || name === "audio") continue; // audio needs a real audio-only source
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  let code = 0;
  let stderr = "";
  try {
    execFileSync(
      YTDLP,
      [
        "-f", format,
        "--newline", "--no-warnings", "--no-playlist",
        "-o", path.join(dir, "%(title).60B.%(ext)s"),
        TARGET,
      ],
      { stdio: ["ignore", "ignore", "pipe"], timeout: 90_000 },
    );
  } catch (e) {
    code = typeof e.status === "number" ? e.status : 1;
    stderr = String(e.stderr || e.message || "");
  }
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.endsWith(".part")) : [];
  const sizes = files.map((f) => fs.statSync(path.join(dir, f)).size);
  const total = sizes.reduce((a, b) => a + b, 0);
  const line = `${name.padEnd(10)} exit=${code} files=${files.length} bytes=${total}`;
  console.log((code === 0 && total > 0 ? "✅ " : "❌ ") + line);
  if (code !== 0 || total === 0) {
    console.error(stderr.split("\n").filter(Boolean).slice(-4).join("\n"));
    fail(`${name} chain did not download anything`);
  }
  results.push({ name, bytes: total });
}

fs.rmSync(root, { recursive: true, force: true });
console.log(
  "\n🎉 REAL SELECTORS PASSED — " +
    results.map((r) => `${r.name}=${r.bytes}B`).join(", "),
);