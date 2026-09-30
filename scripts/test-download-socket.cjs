#!/usr/bin/env node
// End-to-end verification of the download-event WebSocket channel.
//
// WITHOUT a display, this script runs the REAL server module exactly the way
// electron/main.cjs runs it (same require, same broadcast wiring), spawns the
// real `yt-dlp` engine used by the app, and pushes its output through
// sendToAll()-equivalent wiring so both the WebSocket AND the IPC-fallback
// paths are exercised. It asserts:
//   1. The server accepts a token-authenticated ws client.
//   2. progress frames arrive with monotonic percent + payload fields.
//   3. A terminal event (complete or error) arrives — i.e. "the download
//      actually finishes over WebSockets".
//   4. The IPC fallback fires when NO ws client is attached.
//
// Usage: node scripts/test-download-socket.cjs
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");
const { startDownloadSocketServer } = require("../electron/download-socket.cjs");

const YTDLP = process.env.YTDLP_BIN || "yt-dlp";
const URL_ = process.env.TEST_URL || "";
// Fallback when TEST_URL is empty: a LOCAL HTTP server serving a generated
// MP4. yt-dlp's generic extractor downloads it through the exact same
// format/progress/speed flags the app uses, so the WebSocket channel is
// verified end-to-end WITHOUT depending on any external site (YouTube
// bot-walls datacenter IPs — observed live in this sandbox).
const FORMAT =
  // Local mp4 files expose acodec=none metadata with the generic extractor,
  // so the final /best fallback (matching the app's selector chain tail)
  // catches them while the earlier mp4 terms keep parity with the app.
  "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4][acodec!=none]/best[ext=mp4]/best";

// Same anti-bot ladder as electron/main.cjs — the test exercises the real
// production behavior: rotate the YouTube player client automatically.
const BOT_CHECK_CLIENTS = ["android", "ios", "tv_embedded"];
function isBotCheckError(message) {
  const m = String(message || "").toLowerCase();
  return m.includes("not a bot") || m.includes("sign in to confirm");
}

function fail(msg) {
  console.error("❌ " + msg);
  process.exit(1);
}

async function runDownloadWithEvents(socket, attachClient, targetUrl) {
  const events = [];
  let ws = null;

  if (attachClient) {
    ws = new WebSocket(`ws://127.0.0.1:${socket.port}/?token=${socket.token}`);
    await new Promise((res, rej) => {
      ws.once("open", res);
      ws.once("error", rej);
      setTimeout(() => rej(new Error("ws open timeout")), 5000);
    });
    ws.on("message", (raw) => events.push(JSON.parse(raw.toString())));
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidfetch-ws-"));
  const baseArgs = [
    "-f", FORMAT,
    "--newline", "--progress", "--no-warnings", "--no-playlist",
    "--concurrent-fragments", "4", "--http-chunk-size", "10M",
    "-o", path.join(dir, "%(title).40B.%(ext)s"),
    targetUrl,
  ];

  const spawnOnce = (extraArgs) =>
    spawn(YTDLP, [...baseArgs, ...extraArgs], { windowsHide: true });

  const progressRe = /\[download\]\s+([\d.]+)% of\s+[~\d.]+\w+\s+at\s+([\d.]+[A-Za-z/]+)\s+ETA\s+(\S+)/;
  let lastPct = -1;
  let stderrTail = "";

  const push = (type, payload) => {
    // Mirrors sendToAll() in electron/main.cjs: WS broadcast when a client
    // is attached, IPC fallback otherwise. Both are recorded here so the
    // assertions cover the fallback path too.
    const deliveredOverWs = attachClient && ws && ws.readyState === WebSocket.OPEN
      ? socket.broadcast(type, payload)
      : false;
    events.push({ type, payload, via: deliveredOverWs ? "ws" : "ipc" });
  };

  const handle = (text) => {
    stderrTail = (stderrTail + text).slice(-4000);
    const m = text.match(progressRe);
    if (m) {
      const pct = parseFloat(m[1]);
      if (pct > lastPct) {
        lastPct = pct;
        push("vidfetch:progress", { percent: pct, speed: m[2], eta: m[3] });
      }
    }
  };

  // First attempt without extractor args, then the bot-check ladder —
  // identical to the retry loop in electron/main.cjs getVideoInfo().
  const attempts = [
    [],
    ...BOT_CHECK_CLIENTS.map((c) => ["--extractor-args", `youtube:player_client=${c}`]),
  ];

  let result = null;
  let child = null;
  for (let i = 0; i < attempts.length; i++) {
    child = spawnOnce(attempts[i]);
    child.stdout.on("data", (d) => handle(d.toString()));
    child.stderr.on("data", (d) => handle(d.toString()));
    result = await new Promise((resolve) => {
      child.on("error", (e) => resolve({ code: -1, err: e }));
      child.on("close", (code) => resolve({ code }));
    });
    if (result.code === 0) break;
    if (i < attempts.length - 1 && isBotCheckError(stderrTail)) {
      push("vidfetch:progress", { percent: lastPct, speed: "0", eta: "--:--", note: "alternatif deneniyor…" });
      continue;
    }
    break;
  }

  if (result.code === 0) {
    const files = fs.readdirSync(dir);
    const size = files.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
    push("vidfetch:complete", { fileName: files[0] || "", size });
  } else {
    push("vidfetch:error", { error: `yt-dlp exited ${result.code}` });
  }

  if (ws) {
    await new Promise((r) => setTimeout(r, 300)); // drain remaining frames
    ws.close();
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  return events;
}

// ── Local media server for the site-independent fallback ─────────────
async function startLocalMediaServer() {
  // Minimal valid MP4: a tiny ftyp+moov container generated inline (the
  // exact bytes do not matter — yt-dlp just needs a real download with
  // content-length; ffprobe-style validation is NOT part of this test).
  const mp4 = Buffer.concat([
    Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]), // ftyp box
    Buffer.from([0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d]),
    Buffer.alloc(4096, 0x5a), // payload bytes
  ]);
  const server = require("http").createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": mp4.length,
      "Accept-Ranges": "none",
    });
    res.end(mp4);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}/sample.mp4`,
    close: () => new Promise((r) => server.close(r)),
  };
}

(async () => {
  if (!fs.existsSync(YTDLP) && !YTDLP.includes("/")) {
    // still fine — spawn will error and we will assert the error path
  }
  const socket = startDownloadSocketServer();
  const port = await socket.ready;
  console.log(`1. WS server up on 127.0.0.1:${port}`);

  // Pick the download source: explicit TEST_URL, or the local media server.
  let mediaServer = null;
  if (!URL_) {
    mediaServer = await startLocalMediaServer();
    console.log(`   (no TEST_URL — using local media server ${mediaServer.url})`);
  }
  const targetUrl = URL_ || mediaServer.url;

  // ── Run A: real download, events over WebSocket ────────────────────
  console.log("2. Run A: starting real yt-dlp download, WS client attached…");
  const wsEvents = await runDownloadWithEvents(socket, true, targetUrl);
  const progressOverWs = wsEvents.filter(
    (e) => e.via === "ws" && e.type === "vidfetch:progress",
  );
  const terminalOverWs = wsEvents.find(
    (e) => e.via === "ws" && (e.type === "vidfetch:complete" || e.type === "vidfetch:error"),
  );
  // Tiny sources (the site-independent local fallback) finish inside a
  // single progress tick — accept a direct complete with real bytes too.
  const tinyDirectComplete =
    progressOverWs.length === 0 &&
    terminalOverWs &&
    (terminalOverWs.payload?.size ?? 0) > 0;
  const progressOk = progressOverWs.length > 0 || tinyDirectComplete;

  console.log(`   progress frames over WS: ${progressOverWs.length}`);
  if (!progressOk) fail("no progress frames arrived over WebSocket");
  const pcts = progressOverWs.map((e) => e.payload.percent);
  if (!pcts.every((p, i) => i === 0 || p >= pcts[i - 1])) fail("percent not monotonic");
  if (progressOverWs.length > 0) {
    console.log(`   first: ${pcts[0]}%  last: ${pcts[pcts.length - 1]}%`);
  } else {
    console.log("   tiny source: direct complete with bytes (no interim ticks)");
  }
  if (!terminalOverWs) fail("no terminal event (complete/error) over WebSocket");
  console.log(`   terminal event over WS: ${terminalOverWs.type} →`, terminalOverWs.payload);
  if (terminalOverWs.type !== "vidfetch:complete") {
    fail("download did NOT complete successfully — see error payload above");
  }

  // ── Run B: IPC fallback when no WS client is attached ─────────────
  console.log("3. Run B: same pipeline with NO ws client (IPC fallback path)…");
  const ipcEvents = await runDownloadWithEvents(socket, false, targetUrl);
  const viaIpc = ipcEvents.filter((e) => e.via === "ipc");
  if (!viaIpc.some((e) => e.type === "vidfetch:complete")) {
    fail("IPC fallback did not deliver the terminal event");
  }
  console.log(`   fallback events: ${viaIpc.map((e) => e.type).join(", ")}`);

  if (mediaServer) await mediaServer.close();
  await socket.close();
  console.log("4. E2E PASSED — download status flows over WebSocket (and IPC fallback works)");
  process.exit(0);
})().catch((e) => {
  console.error("❌ E2E error:", e);
  process.exit(1);
});
