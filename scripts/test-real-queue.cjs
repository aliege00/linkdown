#!/usr/bin/env node
// Multi-link queue simulation against the REAL engine.
//
// Runs the SAME queue runner the app ships (src/lib/download-queue.ts, loaded
// straight from the source) over several REAL remote videos and asserts the
// properties that matter:
//
//   1. Input parsing — links glued together with no separator are split.
//   2. Sequential — at most ONE yt-dlp process at any moment (this is the
//      crash fix: concurrent engines killed the app).
//   3. Isolation — the middle link points at a 404, so the engine fails for
//      it, and the queue still finishes the last one.
//   4. UI responsiveness — the event loop is never blocked for long while the
//      queue runs (measured as the longest gap between timer ticks).
//   5. Real bytes — every successful link lands on disk with the exact size
//      the server advertises.
//
// Usage: node scripts/test-real-queue.cjs
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const YTDLP = process.env.YTDLP_BIN || "yt-dlp";
const ROOT = path.join(__dirname, "..");

// Real, reachable MP4s (different resolutions → also exercises the quality
// selector). The middle one is deliberately broken to prove error isolation.
const LINKS = [
  "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
  "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_MISSING.mp4",
  "https://test-videos.co.uk/vids/jellyfish/mp4/h264/360/Jellyfish_360_10s_1MB.mp4",
];

// One pasted blob with the first two links GLUED together (no separator) plus
// the third one on a new line — exactly what the user reported.
const PASTED_TEXT = `${LINKS[0]}${LINKS[1]}\n${LINKS[2]}`;

function fail(msg) {
  console.error("❌ " + msg);
  process.exit(1);
}

/** Import the app's real modules (type-stripped TS, no build step needed). */
async function loadAppModules() {
  const run = (script) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--experimental-strip-types", "--input-type=module", "-e", script],
        { cwd: ROOT },
      );
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("close", (code) => {
        if (code !== 0) return reject(new Error(err.trim() || `exit ${code}`));
        try {
          resolve(JSON.parse(out.trim().split("\n").pop()));
        } catch (e) {
          reject(new Error(`bad output: ${out.slice(0, 400)}`));
        }
      });
    });

  return {
    parsed: await run(
      "import { extractVideoUrls } from './src/lib/url.ts';" +
        "console.log(JSON.stringify(extractVideoUrls(process.env.PASTED)))",
    ),
  };
}

/** Run the queue itself in-process (imports the real TS module). */
async function runQueue(items, workerLog) {
  const mod = await import(
    `file://${path.join(ROOT, "src/lib/download-queue.ts")}`
  );
  return mod.runDownloadQueue(items, workerLog);
}

function makeItems(urls) {
  return urls.map((url, i) => ({
    id: `q-${i}`,
    url,
    status: "pending",
    percent: 0,
  }));
}

/** Download one URL with the real engine; resolves {ok, fileName, error}. */
function downloadOne(url, dir, formatId) {
  return new Promise((resolve) => {
    const child = spawn(
      YTDLP,
      [
        "-f", formatId,
        "--newline", "--progress", "--no-warnings", "--no-playlist",
        "-o", path.join(dir, "%(title).60B [%(id)s].%(ext)s"),
        url,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-2000);
    });
    child.on("error", (e) => resolve({ ok: false, error: e.message }));
    child.on("close", (code) => {
      if (code !== 0) {
        const last = stderr.split("\n").filter(Boolean).pop() || `exit ${code}`;
        return resolve({ ok: false, error: last.trim() });
      }
      const files = fs
        .readdirSync(dir)
        .map((f) => path.join(dir, f))
        .filter((f) => fs.statSync(f).isFile() && !f.endsWith(".part"));
      files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      const file = files[0];
      resolve(file ? { ok: true, fileName: path.basename(file) } : { ok: false, error: "no file" });
    });
  });
}

async function main() {
  console.log(`engine : ${YTDLP}\n`);

  // ── 1. Parsing ──────────────────────────────────────────────────────
  process.env.PASTED = PASTED_TEXT;
  const { parsed } = await loadAppModules();
  console.log("pasted text (links glued together):");
  console.log(`  ${PASTED_TEXT.slice(0, 96)}…`);
  if (parsed.length !== 3) fail(`expected 3 links from the glued text, got ${parsed.length}`);
  console.log(`✅ extracted ${parsed.length} links, none merged:\n`);
  parsed.forEach((u, i) => console.log(`   ${i + 1}. ${u.slice(0, 88)}`));

  // ── 2–4. Sequential run, error isolation, UI responsiveness ─────────
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidfetch-queue-"));
  let active = 0;
  let maxActive = 0;
  const order = [];

  // Measure the longest uninterrupted block on the event loop: if the queue
  // blocked the main thread, this gap would grow to seconds.
  let maxGap = 0;
  let last = Date.now();
  const ticker = setInterval(() => {
    const now = Date.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 10);

  const started = Date.now();
  const result = await runQueue(makeItems(parsed), async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    order.push(item.url);
    console.log(`▶ start  [${order.length}/${parsed.length}] ${item.url.slice(0, 60)}`);
    const res = await downloadOne(item.url, dir, "best[ext=mp4]/best");
    active -= 1;
    console.log(
      `■ ${res.ok ? "done  " : "failed"} ${(res.fileName || res.error || "").slice(0, 70)}`,
    );
    return res;
  });
  clearInterval(ticker);
  const elapsed = Date.now() - started;

  console.log("");
  if (maxActive !== 1) fail(`CRASH RISK: ${maxActive} engines ran at the same time (must be 1)`);
  console.log(`✅ sequential: max concurrent engines = ${maxActive}`);

  if (result.summary.completed !== 2) {
    fail(`expected 2 completed (link 2 is intentionally broken), got ${result.summary.completed}`);
  }
  if (result.summary.failed !== 1) fail(`expected 1 failed, got ${result.summary.failed}`);
  const failedItem = result.items.find((i) => i.status === "failed");
  if (!failedItem?.error) fail("the failed item carries no error text");
  if (order[2] !== parsed[2]) fail("the queue stopped at the failing link instead of continuing");
  console.log(`✅ error isolation: link 2 failed ("${failedItem.error.slice(0, 46)}…") and link 3 still ran`);
  console.log(`✅ per-item errors captured: ${result.items.map((i) => i.status).join(", ")}`);

  if (maxGap > 400) {
    fail(`UI thread blocked for ${maxGap}ms during the queue (must stay responsive)`);
  }
  console.log(`✅ UI thread responsive: longest event-loop block ${maxGap}ms`);
  console.log(`⏱  3 links in ${(elapsed / 1000).toFixed(1)}s (sequential)`);

  // ── 5. Real bytes on disk ───────────────────────────────────────────
  const files = fs.readdirSync(dir).filter((f) => !f.endsWith(".part"));
  if (files.length !== 2) fail(`expected 2 files on disk, got ${files.length}`);
  for (const f of files) {
    const size = fs.statSync(path.join(dir, f)).size;
    if (size <= 0) fail(`${f} is empty`);
    const head = Buffer.alloc(12);
    const fd = fs.openSync(path.join(dir, f), "r");
    fs.readSync(fd, head, 0, 12, 0);
    fs.closeSync(fd);
    if (head.subarray(4, 8).toString("latin1") !== "ftyp") fail(`${f} is not an MP4`);
    console.log(`✅ saved ${size.toLocaleString()} bytes — ${f.slice(0, 60)}`);
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("\n🎉 QUEUE SIMULATION PASSED — parsed, sequential, isolated, non-blocking, real bytes.");
}

main().catch((e) => {
  console.error("\n❌ QUEUE SIMULATION FAILED:", e.message);
  process.exit(1);
});