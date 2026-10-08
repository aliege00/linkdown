/**
 * Download-stall regression tests.
 *
 * Shipped bug: "some videos stay at 0% and never continue". yt-dlp runs as a
 * separate process driven over pipes. When that process wedges — a socket that
 * opens but never delivers, a fragment range the CDN never answers, a DNS/TLS
 * black hole on a phone that just lost signal — it simply stops printing
 * progress lines. `YoutubeDL.execute` then neither returns nor throws, so the
 * worker waited forever and the bar sat at whatever it last reached (usually
 * 0%, because the wedge almost always happens during format resolution or on
 * the first fragment).
 *
 * There is no Kotlin runtime in this suite, so `StallWatchdog` is EXECUTED
 * here: its source is extracted from DownloadWorker.kt and run through a small
 * translator, the same way `download-progress.test.ts` does for
 * `ProgressAggregator`. Every translation is asserted, so if the Kotlin drifts
 * away from these shapes the test fails loudly instead of quietly testing a
 * stale copy.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (...p: string[]) => readFileSync(resolve(__dirname, "../..", ...p), "utf-8");
const worker = read("android/app/src/main/java/com/vidfetch/downloader/DownloadWorker.kt");

// ─── Extract + translate the real Kotlin class ────────────────────────────────

/** Returns the body of `internal class <name> { … }` from the worker source. */
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

/** Replaces Kotlin with JS, asserting each shape still exists. */
function sub(text: string, from: string, to: string): string {
  expect(text, `StallWatchdog no longer contains: ${from}`).toContain(from);
  return text.split(from).join(to);
}

function translate(body: string): string {
  // `sub` replaces EVERY occurrence (String.replace with a string pattern
  // replaces only the first, which silently left the second assignment in
  // onLine() un-prefixed and produced a class body that would not parse).
  //
  // Field names go through sentinels: replacing them in place would also match
  // the `this.x` an earlier pass produced, ending up with `this.this.x`.
  let out = sub(withoutCompanion(body), "private var lastActivityAt = 0L", "DECL_LAST = 0;");
  out = sub(out, "private var postProcessing = false", "DECL_POSTPROC = false;");
  out = sub(out, "lastActivityAt = nowMs", "this.LAST_AT = nowMs;");
  out = sub(out, "postProcessing = true", "this.POSTPROC = true;");
  out = sub(out, "postProcessing = false", "this.POSTPROC = false;");

  out = sub(out, "fun arm(nowMs: Long) {", "arm(nowMs) {");
  out = sub(
    out,
    "fun onLine(line: String?, nowMs: Long) {",
    "onLine(line, nowMs) {",
  );
  out = sub(
    out,
    "fun idleMs(nowMs: Long): Long = nowMs - lastActivityAt",
    "idleMs(nowMs) { return nowMs - this.lastActivityAt; }",
  );
  out = sub(
    out,
    "fun limitMs(): Long = if (postProcessing) postProcessTimeoutMs else timeoutMs",
    "limitMs() { return this.postProcessing ? this.postProcessTimeoutMs : this.timeoutMs; }",
  );
  out = sub(
    out,
    "fun isStalled(nowMs: Long): Boolean = idleMs(nowMs) > limitMs()",
    "isStalled(nowMs) { return this.idleMs(nowMs) > this.limitMs(); }",
  );
  out = sub(
    out,
    "if (line != null && POST_PROCESS_MARKERS.any { line.contains(it) }) {",
    "if (line != null && POST_PROCESS_MARKERS.some((it) => line.includes(it))) {",
  );

  // Lift the field initialisers into a constructor. A JS class body cannot
  // carry `this.x = …` as a member — only the constructor may assign them —
  // so the Kotlin property declarations become constructor statements. Only
  // the DECL_ sentinels are lifted; the in-method `this.x = …` assignments
  // carry the plain sentinel and must stay exactly where they are.
  const initialisers: string[] = [];
  out = out
    .replace(/DECL_LAST = 0;/g, () => {
      initialisers.push("this.lastActivityAt = 0;");
      return "";
    })
    .replace(/DECL_POSTPROC = false;/g, () => {
      initialisers.push("this.postProcessing = false;");
      return "";
    });
  // The two constructor `private val`s are Kotlin syntax; give the JS class
  // the same fields from the arguments the test passes in.
  initialisers.push("this.timeoutMs = timeoutMs;");
  initialisers.push("this.postProcessTimeoutMs = postProcessTimeoutMs;");

  out = out
    .split("LAST_AT")
    .join("lastActivityAt")
    .split("POSTPROC")
    .join("postProcessing");

  return `constructor(timeoutMs, postProcessTimeoutMs) { ${initialisers.join(" ")} }\n${out}`;
}

/** The markers exactly as the Kotlin companion declares them. */
const POST_PROCESS_MARKERS: string[] = (() => {
  const start = worker.indexOf("val POST_PROCESS_MARKERS = listOf(");
  expect(start, "POST_PROCESS_MARKERS not found in DownloadWorker.kt").toBeGreaterThan(-1);
  const end = worker.indexOf(")", start);
  const block = worker.slice(start, end);
  const markers = Array.from(block.matchAll(/"([^"]*)"/g)).map((m) => m[1]);
  expect(markers.length, "POST_PROCESS_MARKERS must not be empty").toBeGreaterThan(0);
  return markers;
})();

interface Watchdog {
  arm(nowMs: number): void;
  onLine(line: string | null, nowMs: number): void;
  idleMs(nowMs: number): number;
  limitMs(): number;
  isStalled(nowMs: number): boolean;
}

function makeWatchdog(timeoutMs: number, postProcessTimeoutMs: number): Watchdog {
  const body = translate(extractClass("StallWatchdog"));
  // Assembled by concatenation, not a template literal, for the body: the
  // KDoc inside the class contains backticks.
  const classJs =
    "const StallWatchdog = class {" +
    body +
    "};" +
    "return new StallWatchdog(timeoutMs, postProcessTimeoutMs);";
  const factory = new Function(
    "POST_PROCESS_MARKERS",
    "timeoutMs",
    "postProcessTimeoutMs",
    classJs,
  ) as (m: string[], timeoutMs: number, postMs: number) => Watchdog;
  return factory(POST_PROCESS_MARKERS, timeoutMs, postProcessTimeoutMs);
}

// The values the worker actually ships with.
function shippedTimeouts() {
  const timeout = Number(
    /const val STALL_TIMEOUT_MS = ([\d_]+)L/.exec(worker)?.[1]?.replace(/_/g, ""),
  );
  const postProcess = Number(
    /const val POST_PROCESS_STALL_TIMEOUT_MS = ([\d_]+)L/.exec(worker)?.[1]?.replace(/_/g, ""),
  );
  expect(timeout, "STALL_TIMEOUT_MS not found in DownloadWorker.kt").toBeGreaterThan(0);
  expect(postProcess, "POST_PROCESS_STALL_TIMEOUT_MS not found").toBeGreaterThan(0);
  return { timeout, postProcess };
}

describe("StallWatchdog", () => {
  const { timeout, postProcess } = shippedTimeouts();

  it("exposes the shipped timeouts", () => {
    expect(timeout).toBe(45_000);
    // Post-processing MUST get a much longer leash than the download itself:
    // the ffmpeg merge is silent and can outlast the download.
    expect(postProcess).toBeGreaterThan(timeout * 2);
  });

  it("does not report a stall before the timeout elapses", () => {
    const w = makeWatchdog(timeout, postProcess);
    w.arm(0);
    expect(w.isStalled(timeout)).toBe(false);
    expect(w.isStalled(timeout + 1)).toBe(true);
  });

  it("counts any output as life, even a line with no progress in it", () => {
    const w = makeWatchdog(timeout, postProcess);
    w.arm(0);
    // A normal download: progress lines arrive regularly.
    for (let t = 0; t <= 40_000; t += 2_000) {
      w.onLine("[download]  45.2% of 12.34MiB at 1.02MiB/s ETA 00:07", t);
    }
    // 44s of silence after the last line is still under the 45s window; one
    // millisecond more and the job is restarted.
    expect(w.isStalled(84_000)).toBe(false);
    expect(w.isStalled(85_001)).toBe(true);
  });

  it("stays quiet forever when yt-dlp never prints anything", () => {
    // This is the shipped bug: format resolution wedges before the first
    // progress line, so the callback never fires and the bar never leaves 0%.
    const w = makeWatchdog(timeout, postProcess);
    w.arm(0);
    expect(w.idleMs(0)).toBe(0);
    expect(w.isStalled(timeout)).toBe(false);
    expect(w.isStalled(90_000)).toBe(true);
  });

  it("reports how long the engine has been silent", () => {
    const w = makeWatchdog(timeout, postProcess);
    w.arm(1_000);
    expect(w.idleMs(1_000)).toBe(0);
    expect(w.idleMs(31_000)).toBe(30_000);
  });

  it.each([
    ["[Merger] Merging formats into \"video.mp4\"", "Merger"],
    ["[ExtractAudio] Destination: audio.m4a", "ExtractAudio"],
    ["[VideoConvertor] Merging formats into \"out.mp4\"", "VideoConvertor"],
    ["[Fixup M3u8] Fixing malformed info json", "Fixup"],
  ])("widens the window after post-processing: %s", (line) => {
    const w = makeWatchdog(timeout, postProcess);
    w.arm(0);
    w.onLine("[download] 100.0% of 12.34MiB in 00:12", 1_000);
    w.onLine(line, 2_000);

    expect(w.limitMs()).toBe(postProcess);
    // A merge that takes well over the download timeout is legitimate: the
    // file is already downloaded, killing it here would destroy the transfer.
    expect(w.isStalled(timeout + 60_000)).toBe(false);
    expect(w.isStalled(2_000 + postProcess + 1)).toBe(true);
  });

  it("does NOT widen the window for ordinary download lines", () => {
    const w = makeWatchdog(timeout, postProcess);
    w.arm(0);
    w.onLine("[download] Destination: video.f137.mp4", 1_000);
    w.onLine("[download]  45.2% of 12.34MiB at 1.02MiB/s ETA 00:07", 2_000);
    expect(w.limitMs()).toBe(timeout);
  });

  it("never loses the widened window to a later progress-looking line", () => {
    // yt-dlp interleaves [download] lines after the merge marker; those must
    // not shrink the window back down and kill a running merge.
    const w = makeWatchdog(timeout, postProcess);
    w.arm(0);
    w.onLine("[Merger] Merging formats into \"video.mp4\"", 1_000);
    w.onLine("[download] 100.0% of 12.34MiB", 2_000);
    expect(w.limitMs()).toBe(postProcess);
  });

  it("re-arming resets both the timer and the post-processing flag", () => {
    const w = makeWatchdog(timeout, postProcess);
    w.arm(0);
    w.onLine("[Merger] Merging formats", 1_000);
    expect(w.limitMs()).toBe(postProcess);
    // A fresh attempt (WorkManager retry after a stall) starts clean.
    w.arm(2_000);
    expect(w.limitMs()).toBe(timeout);
    expect(w.isStalled(2_000 + timeout + 1)).toBe(true);
    expect(w.isStalled(2_000 + timeout)).toBe(false);
  });

  it("tolerates a null line (callback with no output attached)", () => {
    const w = makeWatchdog(timeout, postProcess);
    w.arm(0);
    w.onLine(null, 1_000);
    expect(w.idleMs(1_000)).toBe(0);
    expect(w.limitMs()).toBe(timeout);
  });
});

// ─── How the worker uses it ──────────────────────────────────────────────────

describe("DownloadWorker stall recovery", () => {
  it("destroys the wedged yt-dlp process so execute() can unblock", () => {
    // Without this the process is never killed: execute() keeps waiting on a
    // pipe that will never produce another line, and the watchdog only sets a
    // flag nobody acts on.
    expect(worker).toContain("YoutubeDL.destroyProcessById(processId)");
  });

  it("turns a stall into a WorkManager retry rather than a failure", () => {
    expect(worker).toContain("if (stalledByWatchdog) throw DownloadStalledException()");
    expect(worker).toContain("if (runAttemptCount < 3) Result.retry()");
  });

  it("does not throw from the watchdog coroutine itself", () => {
    // progressScope is a SupervisorJob with no CoroutineExceptionHandler, so
    // an exception escaping that launch reaches the global handler and kills
    // the app. The watchdog may only set a flag; the throw has to happen on
    // doWork's own coroutine, after execute() has returned.
    const from = worker.indexOf("var stalledByWatchdog = false");
    const to = worker.indexOf("if (stalledByWatchdog) throw DownloadStalledException()");
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const watchdogBlock = worker.slice(from, to);
    expect(watchdogBlock).toContain("YoutubeDL.destroyProcessById(processId)");
    expect(watchdogBlock, "the watchdog must not throw before execute() returns").not.toContain(
      "throw ",
    );
  });

  it("cancels the watchdog as soon as execute() returns", () => {
    // Otherwise a 45s-old timer could kill a perfectly healthy process during
    // the post-download MediaStore copy.
    expect(worker).toMatch(/finally \{\s*stallJob\.cancel\(\)/);
  });

  it("shows the user what is happening instead of a frozen bar", () => {
    expect(worker).toContain("Bağlantı takıldı, yeniden deneniyor…");
  });

  it("reports a stall with a network-flavoured message when retries run out", () => {
    expect(worker).toContain("The connection kept dropping");
    expect(worker).toMatch(/e is DownloadStalledException/);
  });

  it("uses a short linear WorkManager backoff so a retry starts promptly", () => {
    // WorkManager's default is EXPONENTIAL from 30s: after the watchdog kills
    // a stalled job the user would stare at a frozen bar for half a minute.
    const bridge = read("android/app/src/main/java/com/vidfetch/downloader/DownloadBridge.kt");
    expect(bridge).toContain(".setBackoffCriteria(BackoffPolicy.LINEAR, 10, TimeUnit.SECONDS)");
  });
});

// ─── Speed / resilience flags ────────────────────────────────────────────────

describe("yt-dlp network options", () => {
  function optionsBlock(): string {
    const start = worker.indexOf("val NETWORK_OPTIONS: List<Pair<String, String?>> = listOf(");
    expect(start, "NETWORK_OPTIONS not found in DownloadWorker.kt").toBeGreaterThan(-1);
    const end = worker.indexOf(")", start);
    return worker.slice(start, end);
  }

  /** Every flag actually handed to yt-dlp, ignoring the comments. */
  function addOptionCalls(): string {
    return Array.from(worker.matchAll(/addOption\(\s*"([^"]+)"/g))
      .map((m) => m[1])
      .join("\n");
  }

  it("drops --http-chunk-size, the documented stall suspect", () => {
    // yt-dlp labels it an EXPERIMENTAL throttle bypass and its own FAQ notes
    // YouTube throttles chunked requests. When a CDN mishandles the Range
    // header the chunked downloader waits on data that never arrives — the
    // exact "stuck at 0%" report. It also raised no ceiling, so it was pure
    // risk with no speed benefit.
    //
    // Only real `addOption` calls are inspected: the worker keeps a comment
    // explaining why the flag is absent.
    expect(optionsBlock()).not.toContain("--http-chunk-size");
    expect(addOptionCalls()).not.toContain("--http-chunk-size");
  });

  it("uses the real parallelism lever for DASH/HLS fragments", () => {
    // The count is a per-download setting now (Ayarlar → İndirme hızı), so
    // it is composed by networkOptions() instead of living in the static
    // list — and every request, retries included, goes through it.
    expect(worker).toMatch(/fun networkOptions\(fragments: Int\)/);
    expect(worker).toContain('"--concurrent-fragments" to fragments');
    expect(worker).toContain("DEFAULT_CONCURRENT_FRAGMENTS = 16");
    expect(worker).toContain("MAX_CONCURRENT_FRAGMENTS = 16");
    expect(worker).toContain(
      "for ((flag, value) in networkOptions(concurrentFragments))",
    );
    // The static list keeps the resilience flags (no parallelism in it).
    expect(optionsBlock()).not.toContain("--concurrent-fragments");
  });

  it("turns a dead connection into a resume instead of a hang", () => {
    const block = optionsBlock();
    expect(block).toContain('"--socket-timeout" to "30"');
    expect(block).toContain('"--retries" to "10"');
    expect(block).toContain('"--fragment-retries" to "10"');
    expect(block).toContain('"--file-access-retries" to "3"');
    expect(block).toContain('"--retry-sleep" to "linear=1::2"');
  });

  it("gives a retry the same options — and the user's cookies — as the first try", () => {
    // The retry used to rebuild the request by hand and had already drifted:
    // it silently dropped both --cookies and the network flags.
    expect(worker).toContain("private fun newRequest(");
    expect(worker).toContain(
      "val retryReq = newRequest(url, formatId, isPlaylist, outputTemplate, retry)",
    );
    const newRequest = worker.slice(
      worker.indexOf("private fun newRequest("),
      worker.indexOf("private suspend fun runDownloadWithClients("),
    );
    expect(newRequest).toContain(
      "for ((flag, value) in networkOptions(concurrentFragments))",
    );
    expect(newRequest).toContain('addOption("--cookies", cookieFile.absolutePath)');
    // …and nothing may reintroduce a hand-rolled option list.
    expect(newRequest).not.toContain('addOption("--concurrent-fragments"');
  });

  it("still lets ffmpeg pick a playable container", () => {
    // Forcing MP4 on a VP9/AV1 source produces a file Android cannot decode.
    expect(addOptionCalls()).not.toContain("--merge-output-format");
  });

  it("plumbs the app's speed setting into the worker input data", () => {
    const bridge = read("android/app/src/main/java/com/vidfetch/downloader/DownloadBridge.kt");
    expect(bridge).toMatch(
      /call\.getInt\(\s*"fragments",\s*DownloadWorker\.DEFAULT_CONCURRENT_FRAGMENTS\s*\)/,
    );
    expect(bridge).toContain(".putInt(DownloadWorker.KEY_CONCURRENT_FRAGMENTS, fragments)");
    expect(worker).toContain('const val KEY_CONCURRENT_FRAGMENTS = "concurrentFragments"');
    expect(worker).toMatch(/concurrentFragments = inputData\.getInt\(/);
    // Out-of-range values are clamped before they reach yt-dlp.
    expect(bridge).toMatch(/\.coerceIn\(\s*DownloadWorker\.MIN_CONCURRENT_FRAGMENTS/);
  });
});

// ─── Output capture & validation ─────────────────────────────────────────

describe("DownloadWorker output capture", () => {
  it("captures the MERGED file path, not the temp parts yt-dlp deletes", () => {
    // yt-dlp deletes the per-stream parts after merging: outputFilePath used
    // to point at a file that no longer existed, so the fallback scan could
    // settle on an OLDER download and "validate" the wrong file.
    expect(worker).toContain("Merging formats into");
    expect(worker).toMatch(/MERGED_PATTERN\s*=\s*Regex\(/);
    // The merger line outranks Destination / has-already-been-downloaded.
    expect(worker).toContain("val path = merged ?: dest ?: already");
  });

  it("validates a video job as video and an audio job as audio", () => {
    // Regression: audio-only output (MP3/M4A) was checked for a VIDEO track,
    // so every audio download failed validation, was retried 3× and died
    // with "The downloaded file has no video track".
    expect(worker).toContain("expectsVideo(formatId, downloaded.name)");
    expect(worker).toContain(
      "private fun validateDownloadedFile(file: File, expectsVideoTrack: Boolean)",
    );
    expect(worker).toContain("if (expectsVideoTrack) {");
    // Audio selectors never name a video stream …
    expect(worker).toMatch(
      /f\.contains\("bestaudio"\) && !f\.contains\("bestvideo"\)/,
    );
    // …and an audio extension settles it even when the selector is "best".
    expect(worker).toContain('"mp3", "m4a", "m4b", "aac", "opus", "ogg", "wav", "flac"');
    // A video job still requires BOTH tracks (no muted files either).
    expect(worker).toContain('if (hasAudio != "yes") {');
  });
});

// ─── On-device engine handoff (Seal / ytdlnis / NewPipe) ───────────────────

describe("on-device app handoff", () => {
  const bridge = read("android/app/src/main/java/com/vidfetch/downloader/DownloadBridge.kt");
  const manifest = read("android/app/src/main/AndroidManifest.xml");

  it("exposes the two plugin methods the settings screen needs", () => {
    expect(bridge).toContain("fun getInstalledEngines(call: PluginCall)");
    expect(bridge).toContain("fun openInEngine(call: PluginCall)");
    expect(bridge).toContain("Intent(Intent.ACTION_SEND)");
    expect(bridge).toContain('type = "text/plain"');
    expect(bridge).toContain("putExtra(Intent.EXTRA_TEXT, url)");
  });

  it("covers Seal, ytdlnis and NewPipe by package name", () => {
    for (const pkg of ["com.junkfood.seal", "com.deniscerri.ytdl", "org.schabi.newpipe"]) {
      expect(bridge).toContain(`"${pkg}"`);
      expect(manifest).toContain(`android:name="${pkg}"`);
    }
  });

  it("rejects instead of silently doing nothing when the app cannot take the link", () => {
    expect(bridge).toContain('call.reject("The $id app is not installed or cannot receive links")');
    // …and checks the intent actually resolves before starting it.
    expect(bridge).toContain("queryIntentActivities(");
  });

  it("declares <queries> so Android 11+ can see those packages at all", () => {
    // Without package visibility every installed app reads as "not installed".
    expect(manifest).toContain("<queries>");
    expect(manifest).toContain("android.intent.action.SEND");
  });
});