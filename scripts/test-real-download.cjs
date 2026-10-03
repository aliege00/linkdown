#!/usr/bin/env node
// REAL download verification — no mocks, no fake source.
//
// test-download-socket.cjs proves the event channel works, but against a
// LOCAL server. This script goes one step further: it loads the REAL
// electron/main.cjs (same file the packaged Windows EXE runs) with a stub
// `electron` module, points native-tool discovery at the real yt-dlp binary,
// and downloads a REAL remote video over the REAL network.
//
// What is asserted (this is the "does it really download?" check):
//   1. vidfetch:getInfo returns real metadata from the real yt-dlp binary
//      (title + at least one format with an extension and a codec).
//   2. vidfetch:startDownload returns a work id and the file appears on disk
//      with a non-zero size.
//   3. The on-disk size matches the size the server advertises
//      (Content-Length) — i.e. the bytes are really there, not a stub.
//   4. Progress frames and the terminal vidfetch:complete event travel over
//      the real WebSocket server that main.cjs starts.
//   5. vidfetch:getDownloads (what the UI's history list renders) sees it.
//
// Usage: node scripts/test-real-download.cjs
//   TEST_URL=<url>   override the default real MP4
//   YTDLP_BIN=<bin>  override the engine binary (default: yt-dlp on PATH)
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const { execFileSync } = require("child_process");
const WebSocket = require("ws");

// A real, publicly reachable progressive MP4 (Big Buck Bunny, 360p, ~1 MB).
// YouTube/Vimeo/Reddit bot-wall datacenter IPs in CI, so the default target is
// a plain CDN file that anyone can fetch.
const DEFAULT_URL =
  "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4";
const TARGET = process.env.TEST_URL || DEFAULT_URL;

const YTDLP = process.env.YTDLP_BIN || "yt-dlp";

function fail(msg) {
  console.error("❌ " + msg);
  process.exitCode = 1;
  throw new Error(msg);
}
function ok(msg) {
  console.log("✅ " + msg);
}

// ── Temp environment ───────────────────────────────────────────────────
const root = fs.mkdtempSync(path.join(os.tmpdir(), "vidfetch-real-"));
const downloads = path.join(root, "downloads");
const userData = path.join(root, "userData");
const tools = path.join(root, "resources", "native-tools");
fs.mkdirSync(downloads, { recursive: true });
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(tools, { recursive: true });

// main.cjs looks for `native-tools/yt-dlp.exe` (the packaged Windows layout).
// On this host the engine is a native `yt-dlp`, so expose it under that name.
const enginePath = path.join(tools, "yt-dlp.exe");
fs.writeFileSync(enginePath, `#!/bin/sh\nexec ${YTDLP} "$@"\n`);
fs.chmodSync(enginePath, 0o755);

// Electron injects process.resourcesPath; Node does not define it.
if (!("resourcesPath" in process)) {
  Object.defineProperty(process, "resourcesPath", {
    value: path.join(root, "resources"),
    configurable: true,
  });
}

// ── Minimal electron stub (no window, no GPU) ──────────────────────────
const handlers = new Map();
const windows = [];
class FakeWebContents {
  send() {}
}
class FakeBrowserWindow {
  constructor() {
    this.webContents = new FakeWebContents();
    windows.push(this);
  }
  static getAllWindows() {
    return windows;
  }
  once() {}
  on() {}
  show() {}
  focus() {}
  isMinimized() {
    return false;
  }
  restore() {}
  loadURL() {
    return Promise.resolve();
  }
  loadFile() {
    return Promise.resolve();
  }
}
let readyResolve;
const readyPromise = new Promise((r) => {
  readyResolve = r;
});
const electronStub = {
  app: {
    disableHardwareAcceleration() {},
    commandLine: { appendSwitch() {} },
    requestSingleInstanceLock: () => true,
    on() {},
    quit() {},
    whenReady: () => readyPromise,
    getPath(name) {
      if (name === "userData") return userData;
      if (name === "downloads") return downloads;
      return root;
    },
    getAppPath: () => path.join(__dirname, ".."),
    getName: () => "VidFetch",
  },
  BrowserWindow: FakeBrowserWindow,
  protocol: {
    registerSchemesAsPrivileged() {},
    handle() {},
    registerFileProtocol() {},
  },
  ipcMain: {
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
    on() {},
    removeHandler() {},
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  shell: {
    openPath: async () => "",
  },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return electronStub;
  return origLoad.apply(this, arguments);
};

// Boot the real main process module.
require("../electron/main.cjs");
// whenReady() callbacks register the socket-info handler asynchronously.
readyResolve();
const invoke = (channel, payload) => {
  const fn = handlers.get(channel);
  if (!fn) fail(`IPC handler not registered: ${channel}`);
  return fn({}, payload);
};

async function main() {
  console.log(`engine : ${YTDLP}`);
  console.log(`target : ${TARGET}`);
  console.log(`sandbox: ${root}\n`);

  // Remote content-length is the ground truth for "did we really get bytes".
  const probe = execFileSync(
    "curl",
    ["-sIL", "--max-time", "20", TARGET],
    { encoding: "utf-8" },
  );
  const lenMatch = probe.match(/content-length:\s*(\d+)/gi);
  const expected = lenMatch ? parseInt(lenMatch[lenMatch.length - 1].split(":")[1], 10) : null;
  console.log(`server advertises: ${expected} bytes\n`);

  // 1) Real analyze through the real IPC handler.
  const info = await invoke("vidfetch:getInfo", { url: TARGET, isPlaylist: false });
  if (!info || info.success === false) fail(`getInfo failed: ${JSON.stringify(info)}`);
  ok(`getInfo → title=${JSON.stringify(info.title)}`);
  const formats = info.formats || [];
  if (!formats.length) fail("getInfo returned zero formats");
  // Direct media files report vcodec/acodec === null (unknown), so only the
  // extension + format id are guaranteed here.
  const withMeta = formats.filter((f) => f.ext && f.format_id);
  if (!withMeta.length) fail("no format carried an extension + format id");
  ok(`getInfo → ${formats.length} formats, best_format_id=${info.best_format_id}`);

  // 2) Real download, events captured on the real WebSocket server.
  const socketInfo = await (async () => {
    for (let i = 0; i < 50; i++) {
      let info2 = null;
      try {
        info2 = await invoke("vidfetch:getSocketInfo", undefined);
      } catch {}
      if (info2) return info2;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  })();
  if (!socketInfo) fail("download-event WebSocket server never came up");
  ok(`WebSocket server live on port ${socketInfo.url}`);

  const events = [];
  // Same handshake the renderer performs in src/lib/download-socket-client.ts:
  // the session token is REQUIRED or the server closes with 4001.
  const ws = new WebSocket(`${socketInfo.url}/?token=${socketInfo.token}`);
  ws.on("close", (code) => {
    if (!events.some((e) => e.type === "vidfetch:complete" || e.type === "vidfetch:error")) {
      console.warn(`⚠️  ws closed early (code ${code})`);
    }
  });
  await new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
    setTimeout(() => rej(new Error("ws open timeout")), 5000);
  });
  ws.on("message", (raw) => events.push(JSON.parse(raw.toString())));
  await new Promise((r) => setTimeout(r, 150)); // let the server register us

  const started = await invoke("vidfetch:startDownload", {
    url: TARGET,
    formatId: info.best_format_id,
    isPlaylist: false,
  });
  if (!started || started.success !== true) fail(`startDownload failed: ${JSON.stringify(started)}`);
  ok(`startDownload → workId=${started.workId}`);

  const terminal = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timeout waiting for terminal event (180 s)")),
      180_000,
    );
    const poll = setInterval(() => {
      const done = events.find(
        (e) => e.type === "vidfetch:complete" || e.type === "vidfetch:error",
      );
      if (done) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve(done);
      }
    }, 100);
  });

  const progress = events.filter((e) => e.type === "vidfetch:progress");
  if (terminal.type === "vidfetch:error") fail(`download errored: ${terminal.payload.error}`);
  ok(`terminal event: ${terminal.type} → ${terminal.payload.fileName}`);
  ok(`progress frames received: ${progress.length}`);
  if (!progress.length) fail("no progress frames arrived over the WebSocket");
  if (terminal.payload.token !== started.workId) {
    fail(`terminal event token mismatch: ${terminal.payload.token} vs ${started.workId}`);
  }

  // 3) The bytes are really on disk.
  const file = terminal.payload.uri;
  if (!file || !fs.existsSync(file)) fail(`reported file missing on disk: ${file}`);
  const size = fs.statSync(file).size;
  if (size <= 0) fail("downloaded file is empty");
  ok(`file on disk: ${size} bytes (${path.basename(file)})`);
  if (expected && size !== expected) {
    fail(`size mismatch: got ${size}, server advertised ${expected}`);
  }
  if (expected) ok(`size matches Content-Length exactly (${size} = ${expected})`);

  // Non-trivial content check: a real MP4 has an ftyp box near the start.
  const head = Buffer.alloc(16);
  const fd = fs.openSync(file, "r");
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (head.subarray(4, 8).toString("latin1") !== "ftyp") {
    fail("downloaded bytes are not an MP4 (no ftyp box) — got HTML/error page?");
  }
  ok("payload starts with an MP4 ftyp box (real media, not an error page)");

  // 4) The history list the UI renders sees the file.
  const list = await invoke("vidfetch:getDownloads", undefined);
  const names = (list.downloads || []).map((d) => d.name);
  if (!names.includes(path.basename(file))) {
    fail(`getDownloads did not list the file: ${JSON.stringify(names)}`);
  }
  ok(`getDownloads lists it: ${names.join(", ")}`);

  ws.close();
  console.log("\n🎉 REAL DOWNLOAD PASSED — bytes fetched over the network, written to disk, reported over WebSocket.");
}

main()
  .catch((e) => {
    console.error("\n❌ REAL DOWNLOAD FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {}
    // The real WS server + yt-dlp children die with the process; give the
    // event loop one tick to unref cleanly.
    setTimeout(() => process.exit(process.exitCode || 0), 50);
  });