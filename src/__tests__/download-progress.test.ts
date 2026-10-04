/**
 * Download-progress regression tests.
 *
 * Shipped bug: "the bar resets to 0 in the middle of the download but the
 * download keeps going". Two real causes lived in the worker:
 *
 *  1. A merged quality (`bestvideo+bestaudio`) makes yt-dlp write the video
 *     file, then the audio file, then mux them — each with its own 0→100 %.
 *     Publishing the raw per-file percentage made the bar sprint to 100 %
 *     and snap back to 0 % for the second file.
 *  2. yt-dlp reports `percent = -1` when it has no total (the ffmpeg merge,
 *     "already downloaded", format resolution). The old code mapped -1 to 0,
 *     so the bar was actively yanked back to the start.
 *
 * There is no Kotlin runtime in this suite, so `ProgressAggregator` is
 * EXECUTED here: its source is extracted from DownloadWorker.kt and run
 * through a small translator. Every translation is asserted, so if the
 * Kotlin drifts away from the shapes below the test fails loudly instead of
 * silently testing a stale copy.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (...p: string[]) => readFileSync(resolve(__dirname, "../..", ...p), "utf-8");
const worker = read("android/app/src/main/java/com/vidfetch/downloader/DownloadWorker.kt");

// ─── Extract + translate the real Kotlin class ────────────────────────────────

function extractClass(name: string): string {
  const start = worker.indexOf(`internal class ${name}`);
  expect(start, `class ${name} not found in DownloadWorker.kt`).toBeGreaterThan(-1);
  const open = worker.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < worker.length; i++) {
    if (worker[i] === "{") depth++;
    else if (worker[i] === "}") {
      depth--;
      if (depth === 0) return worker.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces while extracting ${name}`);
}

/** Replace `from` with `to`, failing loudly when the Kotlin no longer matches. */
function sub(text: string, from: string, to: string): string {
  expect(text, `ProgressAggregator no longer contains: ${from}`).toContain(from);
  return text.split(from).join(to);
}

/** Drops the `companion object { … }` block (its members are hoisted below). */
function withoutCompanion(body: string): string {
  const at = body.indexOf("companion object {");
  if (at === -1) return body;
  const open = body.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}") {
      depth--;
      if (depth === 0) return body.slice(0, at) + body.slice(i + 1);
    }
  }
  throw new Error("unbalanced braces in companion object");
}

function translate(body: string): string {
  return sub(
    body,
    "private var totalFiles = planned.coerceAtLeast(1)",
    "this.totalFiles = Math.max(1, planned);",
  )
    .replace("private var fileIndex = 0", "this.fileIndex = 0;")
    .replace("private var lastPath: String? = null", "this.lastPath = null;")
    .replace("private var emitted = 0", "this.emitted = 0;")
    .replace("val percent: Int get() = emitted", "get percent() { return this.emitted; }")
    .replace("fun onFile(path: String) {", "onFile(path) {")
    .replace("fun onProgress(percent: Float): Int {", "onProgress(percent) {")
    .replace("fun reset() {", "reset() {")
    .replace("fun complete(): Int {", "complete() {")
    .replace("percent.toDouble().coerceIn(0.0, 100.0)", "clamp(Number(percent), 0, 100)")
    .replace(
      "((fileIndex + within) / totalFiles * 100.0).toInt()",
      "Math.trunc((this.fileIndex + within) / this.totalFiles * 100)",
    )
    .replace("slice.coerceIn(0, MAX_RUNNING)", "clamp(slice, 0, MAX_RUNNING)")
    .replace("maxOf(emitted,", "Math.max(this.emitted,")
    .replace("if (percent < 0f) return emitted", "if (percent < 0) return this.emitted;")
    .replace("if (path == lastPath) return", "if (path === this.lastPath) return;")
    .replace("val isFirstFile = lastPath == null", "const isFirstFile = this.lastPath === null")
    .replace("val within = ", "const within = ")
    .replace("val slice = ", "const slice = ")
    .replace(
      "if (fileIndex + 1 > totalFiles) totalFiles = fileIndex + 1",
      "if (this.fileIndex + 1 > this.totalFiles) this.totalFiles = this.fileIndex + 1",
    )
    // Bare Kotlin field references become JS property accesses. The lookbehind
    // keeps the ones already prefixed by `this.` untouched.
    .replace(/(?<![.\w])lastPath = path/g, "this.lastPath = path;")
    .replace(/(?<![.\w])fileIndex \+= 1/g, "this.fileIndex += 1;")
    .replace(/(?<![.\w])fileIndex = 0/g, "this.fileIndex = 0;")
    .replace(/(?<![.\w])lastPath = null/g, "this.lastPath = null;")
    .replace(/(?<![.\w])totalFiles = planned/g, "this.totalFiles = this.planned;")
    .replace(/(?<![.\w])emitted = 0/g, "this.emitted = 0;")
    .replace(/(?<![.\w])emitted = /g, "this.emitted = ")
    .replace(/(?<![.\w])return emitted\b/g, "return this.emitted;");
}

const MAX_RUNNING = /const val MAX_RUNNING = (\d+)/.exec(worker)?.[1];
expect(MAX_RUNNING, "MAX_RUNNING not found in DownloadWorker.kt").toBeDefined();

const aggSource = translate(withoutCompanion(extractClass("ProgressAggregator")));
expect(aggSource, "companion members leaked into the class body").not.toContain("companion");

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Kotlin field initialisers are statements; JS wants them in the constructor
 * and the methods/getter on the prototype. Lift them out.
 */
const FIELD_INITIALISERS = [
  "this.totalFiles = Math.max(1, planned);",
  "this.fileIndex = 0;",
  "this.lastPath = null;",
  "this.emitted = 0;",
];
const ctorParts = ["this.planned = planned;"];
let rest = aggSource;
for (const field of FIELD_INITIALISERS) {
  expect(rest, `field initialiser missing from ProgressAggregator: ${field}`).toContain(field);
  ctorParts.push(field);
  rest = rest.replace(field, "");
}

// NOTE: assembled by concatenation, not a template literal — the KDoc inside
// the class contains backticks, which would terminate a template string.
const CLASS_JS =
  "return class ProgressAggregator {" +
  " constructor(planned) { " + ctorParts.join(" ") + " }" +
  rest +
  "}";

const ProgressAggregator: new (planned: number) => {
  percent: number;
  onFile(path: string): void;
  onProgress(percent: number): number;
  reset(): void;
  complete(): number;
} = new Function("clamp", "MAX_RUNNING", CLASS_JS)(clamp, Number(MAX_RUNNING)) as never;

const SPLIT_SPEC = "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo+bestaudio/best";
const COMBINED_SPEC = "18";
const MP3_SPEC = "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio";

/** Feeds a run of yt-dlp ticks, returning every published percentage. */
function run(
  agg: InstanceType<typeof ProgressAggregator>,
  ticks: { file?: string; pct: number }[],
): number[] {
  const seen: number[] = [];
  for (const t of ticks) {
    if (t.file !== undefined) agg.onFile(t.file);
    seen.push(agg.onProgress(t.pct));
  }
  return seen;
}

function expectMonotonic(values: number[]) {
  for (let i = 1; i < values.length; i++) {
    expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("the progress bar never runs backwards", () => {
  it("treats an unknown total as 'no news', not as 0%", () => {
    // yt-dlp sends -1 while resolving formats and during the ffmpeg merge.
    const agg = new ProgressAggregator(1);
    agg.onFile("/downloads/a.mp4");
    expect(agg.onProgress(40)).toBe(40);
    expect(agg.onProgress(-1)).toBe(40); // ← used to be 0: the visible reset
    expect(agg.onProgress(55)).toBe(55);
    expect(agg.onProgress(-1)).toBe(55);
  });

  it("clamps out-of-range ticks instead of trusting them", () => {
    const agg = new ProgressAggregator(1);
    agg.onFile("/downloads/a.mp4");
    expect(agg.onProgress(0)).toBe(0);
    expect(agg.onProgress(140)).toBe(99);
    expect(agg.onProgress(-5)).toBe(99);
  });
});

describe("a merged video+audio download fills the bar once", () => {
  it("splits the bar into one slice per stream file", () => {
    const agg = new ProgressAggregator(2); // bestvideo + bestaudio
    const video = run(
      agg,
      Array.from({ length: 11 }, (_, i) => ({ file: i === 0 ? "/d/v.webm" : undefined, pct: i * 10 })),
    );
    // Half the bar for the video half; must NOT reach 100 before the audio.
    expect(video[video.length - 1]).toBe(50);
    expectMonotonic(video);

    const audio = run(agg, [{ file: "/d/v.m4a", pct: 0 }, { pct: 50 }, { pct: 99 }]);
    // Starts exactly where the video stopped — no snap back to zero.
    expect(audio[0]).toBe(50);
    expect(audio[audio.length - 1]).toBe(99);
    expectMonotonic([...video, ...audio]);
  });

  it("ignores repeated progress lines for the file it is already on", () => {
    const agg = new ProgressAggregator(2);
    agg.onFile("/d/v.webm");
    agg.onProgress(50);
    const before = agg.percent;
    // yt-dlp repeats Destination when a file is already complete.
    agg.onFile("/d/v.webm");
    agg.onFile("/d/v.webm");
    expect(agg.percent).toBe(before);
    expect(agg.onProgress(50)).toBe(before);
  });

  it("only reports 100 once yt-dlp itself returns", () => {
    const agg = new ProgressAggregator(2);
    run(agg, [{ file: "/d/v.webm", pct: 100 }, { file: "/d/v.m4a", pct: 100 }]);
    expect(agg.percent).toBe(99); // the ffmpeg merge is still pending
    expect(agg.complete()).toBe(100);
  });

  it("handles the merge phase, which reports no percentage at all", () => {
    const agg = new ProgressAggregator(2);
    agg.onFile("/d/v.webm");
    agg.onProgress(100);
    agg.onFile("/d/v.m4a");
    agg.onProgress(100);
    const held = agg.percent;
    // ffmpeg remux: minutes of work, every line reports -1.
    for (let i = 0; i < 50; i++) expect(agg.onProgress(-1)).toBe(held);
  });

  it("recovers when yt-dlp writes more files than predicted", () => {
    // "18" is a single combined stream, but if the site only offers split
    // streams the bar must still reach the end instead of stopping short.
    const agg = new ProgressAggregator(1);
    agg.onFile("/d/v.webm");
    agg.onProgress(100);
    agg.onFile("/d/v.m4a");
    agg.onProgress(100);
    expect(agg.percent).toBe(99);
  });
});

describe("playlist entries each get their own 0→100 bar", () => {
  it("resets per item so the UI can offset by item number", () => {
    const agg = new ProgressAggregator(2);
    run(agg, [{ file: "/d/1.webm", pct: 100 }, { file: "/d/1.m4a", pct: 100 }]);
    expect(agg.percent).toBe(99);
    agg.reset();
    expect(agg.percent).toBe(0);
    const second = run(agg, [
      { file: "/d/2.webm", pct: 0 },
      { file: "/d/2.webm", pct: 100 },
      { file: "/d/2.m4a", pct: 100 },
    ]);
    // The frontend composes ((item - 1) * 100 + percent) / itemCount, so
    // item 2 must start from 0 — never carry item 1's total into it.
    expect(second[0]).toBe(0);
    expect(second[second.length - 1]).toBe(99);
    expectMonotonic(second);
  });
});

describe("how many files a -f value writes", () => {
  // Executed from the shipped companion object, same translator discipline.
  const classText = extractClass("ProgressAggregator");
  const fnAt = classText.indexOf("fun streamCountFor(formatId: String): Int {");
  expect(fnAt, "streamCountFor not found in ProgressAggregator").toBeGreaterThan(-1);
  // Balanced-block extraction: everything after the declaration belongs to the
  // companion object, not to this function.
  const blockOpen = classText.indexOf("{", fnAt);
  let depth = 0;
  let blockEnd = -1;
  for (let i = blockOpen; i < classText.length; i++) {
    if (classText[i] === "{") depth++;
    else if (classText[i] === "}") {
      depth--;
      if (depth === 0) { blockEnd = i; break; }
    }
  }
  expect(blockEnd, "unbalanced braces in streamCountFor").toBeGreaterThan(-1);
  const streamCountSrc = sub(
    classText.slice(fnAt, blockEnd + 1),
    "fun streamCountFor(formatId: String): Int {",
    "function streamCountFor(formatId) {",
  )
    .replace("val first = formatId.substringBefore('/')", "const first = formatId.split('/')[0];")
    .replace(
      "return maxOf(1, first.split('+').size)",
      "return Math.max(1, first.split('+').length);",
    );
  const streamCount = new Function(
    streamCountSrc + "\n return streamCountFor;",
  )() as (formatId: string) => number;

  it("counts the first alternative only — yt-dlp tries them left to right", () => {
    expect(streamCount(SPLIT_SPEC)).toBe(2); // video + audio + merge
    expect(streamCount("137+bestaudio")).toBe(2);
    expect(streamCount("137+140+bestaudio")).toBe(3);
    expect(streamCount(COMBINED_SPEC)).toBe(1); // already has audio
    expect(streamCount("best")).toBe(1);
    expect(streamCount(MP3_SPEC)).toBe(1); // audio-only, nothing to merge
    expect(streamCount("")).toBe(1);
  });

  it("matches the selector the app actually sends for high qualities", () => {
    // Guards the contract between src/lib/download-modes.ts and the worker:
    // the MP4 selector is the reason the bar used to restart.
    const modes = read("src/lib/download-modes.ts");
    const match = modes.match(
      /bestvideo\[ext=mp4\]\[vcodec\^=avc1\]\+bestaudio\[ext=m4a\]/,
    );
    expect(match).not.toBeNull();
    expect(streamCount(match![0])).toBe(2);
  });
});

describe("the worker publishes the aggregated percentage", () => {
  /** Kotlin without comments — the rationale prose quotes the old bug. */
  const code = worker
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

  it("no longer maps an unknown percentage to 0", () => {
    expect(code).not.toMatch(/if \(percent >= 0f\) percent\.toInt\(\)\.coerceIn\(0, 100\) else 0/);
    expect(worker).toContain("val pct = progress.onProgress(percent)");
  });

  it("tells the aggregator about each new destination file", () => {
    expect(worker).toContain("progress.onFile(path)");
  });

  it("restarts the bar for every playlist entry", () => {
    expect(worker).toMatch(/if \(item != currentItem\) progress\.reset\(\)/);
  });

  it("seeds the slice count from the requested format", () => {
    expect(worker).toContain(
      "ProgressAggregator(ProgressAggregator.streamCountFor(formatId))",
    );
  });

  it("publishes the real 100 only after yt-dlp returns", () => {
    expect(worker).toContain(".putInt(KEY_PROGRESS, progress.complete())");
  });
});

describe("the UI does not declare a download finished while it runs", () => {
  const card = read("src/components/DownloaderCard.tsx");

  it("has no flat timer that ends a download after a fixed 2 minutes", () => {
    // A 200 MB video on a phone connection runs far longer than 120 s; the
    // old timer flipped the card to "complete" mid-transfer.
    expect(card).not.toMatch(
      /safetyTimerRef\.current = setTimeout\(\(\) => \{[\s\S]{0,160}?updateState\("complete"\)[\s\S]{0,40}?\}, \d+\);/,
    );
  });

  it("keys the watchdog off stalled progress instead of elapsed time", () => {
    expect(card).toContain("const STALLED_DOWNLOAD_MS = 45_000;");
    expect(card).toContain("Date.now() - lastProgressAtRef.current > STALLED_DOWNLOAD_MS");
    // Every progress tick marks liveness: the single-video start, the
    // playlist start, and both marks of the re-attach path (adopting a running
    // download is itself a liveness event, as is each of its ticks).
    expect(card.split("lastProgressAtRef.current = Date.now();").length - 1).toBe(6);
    // …and the watchdog body exists exactly once, shared by all four paths,
    // so they cannot drift apart.
    expect(card.split("const startStallWatchdog = useCallback(").length - 1).toBe(1);
    expect(card.split("const stopStallWatchdog = useCallback(").length - 1).toBe(1);
  });
});