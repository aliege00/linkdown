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

// ── YouTube anti-bot mitigations ────────────────────────────────────
// YouTube increasingly requires either real browser cookies or a PO token
// provider (e.g. bgutil-ytdlp-pot-provider) to bypass the "Sign in to
// confirm you're not a bot" check. These are OPT-IN settings the user can
// configure in the app's advanced section.

function youtubeSettingsPayload() {
  return {
    cookiesBrowser: settings.cookiesBrowser || "",
    cookiesFileName: settings.cookiesFile
      ? path.basename(settings.cookiesFile)
      : "",
    poTokenProvider: settings.poTokenProvider || "",
  };
}

/**
 * Extra yt-dlp args for YouTube anti-bot mitigations, based on the user's
 * settings. Empty when nothing is configured (default behavior unchanged).
 */
function youtubeMitigationArgs() {
  const args = [];
  if (settings.cookiesBrowser) {
    args.push("--cookies-from-browser", String(settings.cookiesBrowser));
  } else if (settings.cookiesFile && fs.existsSync(settings.cookiesFile)) {
    args.push("--cookies", settings.cookiesFile);
  }
  if (settings.poTokenProvider) {
    // bgutil-ytdlp-pot-provider HTTP server (bundled as a yt-dlp plugin in
    // native-tools/yt-dlp-plugins). With no args the plugin already defaults
    // to http://127.0.0.1:4416 — this setting only matters for a different
    // host/port (e.g. the server running on another machine on the LAN).
    args.push(
      "--extractor-args",
      `youtubepot-bgutilhttp:base_url=${settings.poTokenProvider}`,
    );
  }
  return args;
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

async function getVideoInfo(url, isPlaylist) {
  if (!fs.existsSync(YTDLP_EXE)) {
    return {
      success: false,
      error: "The download engine (yt-dlp) is missing from this EXE build.",
    };
  }

  const args = [
    "--dump-single-json",
    "--no-warnings",
    ...youtubeMitigationArgs(),
  ];
  if (isPlaylist) {
    // Playlist URLs: fetch only the playlist metadata + a flat list of its
    // videos (fast — no per-video format extraction until download starts).
    args.push("--flat-playlist");
  } else {
    args.push("--no-playlist");
  }
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

  // Playlist — return the flat entry list so the UI can show every video.
  if (info._type === "playlist" || Array.isArray(info.entries)) {
    const entries = (info.entries || [])
      .map((e) => ({
        id: e.id || "",
        title: e.title || e.fulltitle || "",
        url: e.url || e.webpage_url || "",
        duration: e.duration || null,
        thumbnail: e.thumbnail || null,
      }))
      .filter((e) => e.id || e.title);

    return {
      success: true,
      is_playlist: true,
      id: info.id || "",
      title: info.title || "Playlist",
      duration: null,
      thumbnail: info.thumbnail || null,
      uploader: info.uploader || info.channel || "",
      uploader_url: info.uploader_url || info.channel_url || null,
      webpage_url: info.webpage_url || url,
      formats: [],
      best_format_id: "best",
      best_audio_format_id: null,
      ffmpeg_available: fs.existsSync(FFMPEG_EXE),
      count: entries.length,
      entries,
    };
  }

  const formats = (info.formats || []).map(mapFormat).filter(
    (f) => f.vcodec || f.acodec, // drop text-only formats
  );

  return {
    success: true,
    is_playlist: false,
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

async function startDownload(url, formatId, isPlaylist) {
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
    "--no-warnings",
    ...youtubeMitigationArgs(),
  ];
  let outputTemplate;
  if (isPlaylist) {
    // Playlist downloads land in "<playlist title> [<id>]/NNN - title [id].ext"
    // so every video from the playlist stays grouped in one folder.
    outputTemplate = path.join(
      dir,
      "%(playlist_title).150B [%(playlist_id)s]",
      "%(playlist_index)03d - %(title).180B [%(id)s].%(ext)s",
    );
  } else {
    args.push("--no-playlist");
    outputTemplate = path.join(dir, "%(title).180B [%(id)s].%(ext)s");
  }
  args.push("-o", outputTemplate);
  if (fs.existsSync(FFMPEG_EXE)) {
    args.push("--ffmpeg-location", path.dirname(FFMPEG_EXE));
    // Merge video-only + audio selections (e.g. 1080p+) into a single mp4.
    args.push("--merge-output-format", "mp4");
  }
  args.push(url);

  const child = spawn(YTDLP_EXE, args, { windowsHide: true });
  activeDownloads.set(token, child);

  let fullTitle = "";
  let playlistDir = "";
  let item = 0;
  let itemCount = 0;
  // NOTE: yt-dlp pads its progress lines with variable whitespace — the
  // line is "0.1% of  967.79KiB at  Unknown B/s ETA Unknown" (two spaces
  // after "of"). The \s+ below is required, a single space never matches.
  // Lines with "Unknown" speed/ETA are skipped (they are 0% anyway); real
  // speed/ETA tokens are captured for the UI.
  const progressRe = /\[download\]\s+([\d.]+)% of\s+[~\d.]+\w+\s+at\s+([\d.]+[A-Za-z/]+)\s+ETA\s+(\S+)/;
  const titleRe = /\[download\] Destination: (.+)$/m;
  const itemRe = /Downloading item (\d+) of (\d+)/;

  const handleChunk = (text) => {
    const dest = text.match(titleRe);
    if (dest) {
      fullTitle = dest[1];
      if (!playlistDir) playlistDir = path.dirname(dest[1]);
    }
    const im = text.match(itemRe);
    if (im) {
      item = parseInt(im[1], 10);
      itemCount = parseInt(im[2], 10);
    }
    const m = text.match(progressRe);
    if (m) {
      sendToAll("vidfetch:progress", {
        token,
        percent: parseFloat(m[1]),
        speed: m[2],
        eta: m[3],
        item: item || undefined,
        itemCount: itemCount || undefined,
        fileName: isPlaylist && playlistDir ? path.basename(playlistDir) : undefined,
      });
    }
  };
  child.stdout.on("data", (d) => handleChunk(d.toString()));
  child.stderr.on("data", (d) => handleChunk(d.toString()));

  child.on("close", (code) => {
    activeDownloads.delete(token);
    if (code === 0) {
      let file = "";
      if (isPlaylist) {
        // Point the UI at the playlist's folder, not a single file.
        file = playlistDir && fs.existsSync(playlistDir)
          ? playlistDir
          : newestSubdir(dir);
      } else {
        file = fullTitle && fs.existsSync(fullTitle)
          ? fullTitle
          : newestFile(dir);
      }
      sendToAll("vidfetch:complete", {
        token,
        uri: file || "",
        fileName: file ? path.basename(file) : "",
        isPlaylist: !!isPlaylist,
        fileCount: itemCount || undefined,
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

function newestSubdir(dir) {
  try {
    const dirs = fs.readdirSync(dir).map((n) => path.join(dir, n));
    dirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return dirs.find((d) => fs.statSync(d).isDirectory()) || "";
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

ipcMain.handle("vidfetch:getInfo", async (_event, { url, isPlaylist }) => {
  if (!url) return { success: false, error: "URL is required" };
  try {
    return await getVideoInfo(url, !!isPlaylist);
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle("vidfetch:startDownload", async (_event, { url, formatId, isPlaylist }) => {
  return startDownload(url, formatId, !!isPlaylist);
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

// Recursively list files (so playlist subfolders show up too), using the
// path relative to the download folder as the display name.
async function walkDir(dir, depth) {
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      const st = await fsp.stat(full);
      if (st.isDirectory()) {
        if (depth > 0) out.push(...(await walkDir(full, depth - 1)));
      } else {
        out.push({
          uri: full,
          name: full.replace(dir + path.sep, ""),
          mime: "video/*",
          size: st.size,
          date: st.mtimeMs,
        });
      }
    } catch {}
  }
  return out;
}

ipcMain.handle("vidfetch:getDownloads", async () => {
  const dir = getDownloadDir();
  try {
    const out = await walkDir(dir, 2);
    out.sort((a, b) => (b.date || 0) - (a.date || 0));
    return { downloads: out };
  } catch {
    return { downloads: [] };
  }
});

ipcMain.handle("vidfetch:getLocation", () => locationPayload());

ipcMain.handle("vidfetch:getYouTubeSettings", () => youtubeSettingsPayload());

ipcMain.handle("vidfetch:setCookiesBrowser", (_event, { browser }) => {
  settings.cookiesBrowser = browser ? String(browser) : undefined;
  // A browser session and a cookies.txt file are mutually exclusive — the
  // file wins only when no browser is chosen.
  saveSettings();
  return youtubeSettingsPayload();
});

ipcMain.handle("vidfetch:pickCookieFile", async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const res = await dialog.showOpenDialog(win, {
    title: "Choose a cookies.txt file",
    filters: [
      { name: "Cookies", extensions: ["txt", "cookies"] },
      { name: "All files", extensions: ["*"] },
    ],
    properties: ["openFile"],
  });
  if (res.canceled || !res.filePaths.length) return null;
  settings.cookiesFile = res.filePaths[0];
  settings.cookiesBrowser = undefined;
  saveSettings();
  return youtubeSettingsPayload();
});

ipcMain.handle("vidfetch:clearCookieFile", () => {
  settings.cookiesFile = undefined;
  saveSettings();
  return youtubeSettingsPayload();
});

ipcMain.handle("vidfetch:setPoTokenProvider", (_event, { url }) => {
  const trimmed = url ? String(url).trim() : "";
  settings.poTokenProvider = trimmed ? trimmed : undefined;
  saveSettings();
  return youtubeSettingsPayload();
});

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
