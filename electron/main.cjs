// VidFetch desktop shell.
// Loads the built web app (dist/) inside Electron, gets packaged as a
// portable Windows EXE by electron-builder (see electron-builder.yml), and
// drives a bundled yt-dlp + ffmpeg engine via IPC to the renderer.
const {
  app,
  BrowserWindow,
  protocol,
  ipcMain,
  dialog,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const { spawn } = require("child_process");

// Privileged custom scheme so the app can load via app:// (this makes the
// absolute /assets/... paths Vite generates resolve correctly, which plain
// file:// loading cannot do).
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const DIST_DIR = path.join(__dirname, "..", "dist");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

function serveFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const data = fs.readFileSync(filePath);
  return new Response(data, {
    headers: { "Content-Type": contentType },
  });
}

// ── yt-dlp engine ─────────────────────────────────────────────────────

function nativeTool(name) {
  const candidates = [
    path.join(process.resourcesPath, "native-tools", name), // packaged EXE
    path.join(__dirname, "..", "native-tools", name), // repo checkout
    path.join(__dirname, "native-tools", name),
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

const YTDLP_EXE = nativeTool("yt-dlp.exe");
const FFMPEG_EXE = nativeTool("ffmpeg.exe");

function settingsFile() {
  return path.join(app.getPath("userData"), "vidfetch-settings.json");
}

let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(settingsFile(), "utf-8"));
} catch {
  settings = {};
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (e) {
    console.warn("Failed to save settings", e);
  }
}

function defaultDownloadDir() {
  return path.join(app.getPath("downloads"), "VidFetch");
}

function getDownloadDir() {
  return settings.downloadDir && fs.existsSync(settings.downloadDir)
    ? settings.downloadDir
    : defaultDownloadDir();
}

function locationPayload() {
  const dir = getDownloadDir();
  return { uri: dir, name: path.basename(dir), isDefault: dir === defaultDownloadDir() };
}

// ── Video info (yt-dlp --dump-single-json) ───────────────────────────

function mapFormat(f) {
  let resolution = "unknown";
  if (f.resolution && f.resolution !== "audio only") resolution = f.resolution;
  else if (f.height) resolution = `${f.width || "?"}x${f.height}`;
  else if (f.format_note) resolution = String(f.format_note);

  return {
    format_id: f.format_id || "",
    ext: f.ext || "",
    resolution,
    filesize: f.filesize || f.filesize_approx || null,
    vcodec: f.vcodec && f.vcodec !== "none" ? f.vcodec : null,
    acodec: f.acodec && f.acodec !== "none" ? f.acodec : null,
    fps: f.fps || null,
    tbr: f.tbr || null,
  };
}

function pickBestFormatId(formats) {
  const usable = formats.filter((f) => f.vcodec !== "none" || f.acodec !== "none");
  const both = usable.filter((f) => f.vcodec !== "none" && f.acodec !== "none");
  const pool = both.length ? both : usable;
  if (!pool.length) return "best";
  return pool.reduce((best, f) => {
    const h = (f.height || 0);
    const bh = best.height || 0;
    return h > bh ? f : best;
  }).format_id || "best";
}

async function getVideoInfo(url) {
  if (!fs.existsSync(YTDLP_EXE)) {
    return {
      success: false,
      error: "The download engine (yt-dlp) is missing from this EXE build.",
    };
  }

  const args = [
    "--dump-single-json",
    "--no-playlist",
    "--no-warnings",
    "--no-call-home",
  ];
  if (fs.existsSync(FFMPEG_EXE)) {
    args.push("--ffmpeg-location", path.dirname(FFMPEG_EXE));
  }
  args.push(url);

  const out = await new Promise((resolve, reject) => {
    const child = spawn(YTDLP_EXE, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`)),
    );
  });

  const info = JSON.parse(out);
  const formats = (info.formats || []).map(mapFormat).filter(
    (f) => f.vcodec || f.acodec, // drop text-only formats
  );

  return {
    success: true,
    id: info.id || "",
    title: info.title || "",
    duration: info.duration || null,
    thumbnail: info.thumbnail || null,
    uploader: info.uploader || info.channel || "",
    uploader_url: info.uploader_url || info.channel_url || null,
    webpage_url: info.webpage_url || url,
    formats,
    best_format_id: pickBestFormatId(info.formats || []),
    best_audio_format_id: null,
    ffmpeg_available: fs.existsSync(FFMPEG_EXE),
  };
}

// ── Download (spawn with progress parsing) ───────────────────────────

const activeDownloads = new Map(); // token -> child

function sanitizeName(name) {
  return String(name || "video").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 180);
}

async function startDownload(url, formatId) {
  if (!fs.existsSync(YTDLP_EXE)) {
    return { success: false, error: "The download engine (yt-dlp) is missing from this EXE build." };
  }

  const token = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const dir = getDownloadDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return { success: false, error: `Cannot create download folder: ${e.message}` };
  }

  const args = [
    "-f", formatId || "best",
    "--newline",
    "--progress",
    "--no-playlist",
    "--no-warnings",
    "--no-call-home",
    "-o", path.join(dir, "%(title).180B [%(id)s].%(ext)s"),
  ];
  if (fs.existsSync(FFMPEG_EXE)) {
    args.push("--ffmpeg-location", path.dirname(FFMPEG_EXE));
  }
  args.push(url);

  const child = spawn(YTDLP_EXE, args, { windowsHide: true });
  activeDownloads.set(token, child);

  let fullTitle = "";
  const progressRe = /\[download\]\s+([\d.]+)% of [~\d.]+\w+\s+at\s+([\d.]+[A-Za-z/]+)\s+ETA\s+(\S+)/;
  const titleRe = /\[download\] Destination: (.+)$/m;

  child.stdout.on("data", (d) => {
    const text = d.toString();
    const dest = text.match(titleRe);
    if (dest) fullTitle = dest[1];
    const m = text.match(progressRe);
    if (m) {
      sendToAll("vidfetch:progress", {
        token,
        percent: parseFloat(m[1]),
        speed: m[2],
        eta: m[3],
      });
    }
  });
  child.stderr.on("data", (d) => {
    const text = d.toString();
    const m = text.match(progressRe);
    if (m) {
      sendToAll("vidfetch:progress", {
        token,
        percent: parseFloat(m[1]),
        speed: m[2],
        eta: m[3],
      });
    }
  });

  child.on("close", (code) => {
    activeDownloads.delete(token);
    if (code === 0) {
      const file = fullTitle && fs.existsSync(fullTitle)
        ? fullTitle
        : newestFile(dir);
      sendToAll("vidfetch:complete", {
        token,
        uri: file || "",
        fileName: file ? path.basename(file) : "",
      });
    } else {
      sendToAll("vidfetch:error", {
        token,
        error: `Download failed (yt-dlp exited with code ${code}).`,
      });
    }
  });

  return { success: true, workId: token };
}

function newestFile(dir) {
  try {
    const files = fs.readdirSync(dir).map((n) => path.join(dir, n));
    files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return files.find((f) => fs.statSync(f).isFile()) || "";
  } catch {
    return "";
  }
}

function sendToAll(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

// ── Window ───────────────────────────────────────────────────────────

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    autoHideMenuBar: true,
    backgroundColor: "#0b0b0f",
    title: "VidFetch",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  win.loadURL("app://index.html");
}

// ── IPC handlers ─────────────────────────────────────────────────────

ipcMain.handle("vidfetch:getInfo", async (_event, { url }) => {
  if (!url) return { success: false, error: "URL is required" };
  try {
    return await getVideoInfo(url);
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle("vidfetch:startDownload", async (_event, { url, formatId }) => {
  return startDownload(url, formatId);
});

ipcMain.handle("vidfetch:cancel", (_event, { token }) => {
  const child = activeDownloads.get(token);
  if (child) {
    try {
      child.kill();
    } catch {}
  }
  return { success: true };
});

ipcMain.handle("vidfetch:openFile", async (_event, { filePath }) => {
  if (!filePath || !fs.existsSync(filePath)) return { success: false };
  const err = await shell.openPath(filePath);
  return { success: !err, error: err || undefined };
});

ipcMain.handle("vidfetch:getDownloads", async () => {
  const dir = getDownloadDir();
  try {
    const entries = await fsp.readdir(dir);
    const out = [];
    for (const name of entries) {
      const full = path.join(dir, name);
      try {
        const st = await fsp.stat(full);
        if (!st.isFile()) continue;
        out.push({
          uri: full,
          name,
          mime: "video/*",
          size: st.size,
          date: st.mtimeMs,
        });
      } catch {}
    }
    out.sort((a, b) => (b.date || 0) - (a.date || 0));
    return { downloads: out };
  } catch {
    return { downloads: [] };
  }
});

ipcMain.handle("vidfetch:getLocation", () => locationPayload());

ipcMain.handle("vidfetch:pickFolder", async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const res = await dialog.showOpenDialog(win, {
    title: "Choose a download folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (res.canceled || !res.filePaths.length) return null;
  settings.downloadDir = res.filePaths[0];
  saveSettings();
  return locationPayload();
});

ipcMain.handle("vidfetch:resetLocation", () => {
  settings.downloadDir = undefined;
  saveSettings();
  return locationPayload();
});

// ── App lifecycle ────────────────────────────────────────────────────

app.whenReady().then(() => {
  protocol.handle("app", (request) => {
    // The app is loaded at "app://index.html" where "index.html" is the HOST,
    // not the path — parse properly and resolve against DIST_DIR.
    let pathname = "/index.html";
    try {
      const parsed = new URL(request.url);
      if (parsed.pathname && parsed.pathname !== "/") {
        pathname = decodeURIComponent(parsed.pathname);
      }
    } catch {
      pathname = "/index.html";
    }

    const safePath = pathname.replace(/^(\.\.(\/|\\))+/, "");
    const filePath = path.join(DIST_DIR, safePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return serveFile(filePath);
    }
    return serveFile(path.join(DIST_DIR, "index.html"));
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
