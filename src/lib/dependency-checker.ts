/**
 * FFmpeg Dependency Checker (TypeScript / Electron)
 *
 * Checks for FFmpeg on the desktop app's startup and downloads a static
 * build if missing. Runs entirely in the background — never blocks the UI.
 *
 * Architecture:
 *   1. Search known paths for ffmpeg binary
 *   2. If found → return path, log version
 *   3. If missing → download latest static build via Node.js
 *   4. Extract to app-local bin directory
 *   5. Update PATH for the current process
 *
 * This module works in:
 *   - Electron main process (Node.js)
 *   - Browser (via fetch API for download, limited PATH support)
 *
 * Environment variables:
 *   FFMPEG_PATH        Override: full path to ffmpeg binary
 *   LINKDOWN_BIN_DIR   Override: custom bin directory
 */

import { execFile, execSync } from "child_process";
import { existsSync, mkdirSync, chmodSync, createWriteStream, readdirSync, renameSync, unlinkSync } from "fs";
import { join } from "path";
import { platform, arch, homedir } from "os";

const env = process.env;

// ── Types ───────────────────────────────────────────────────────────────────

export interface DependencyStatus {
  available: boolean;
  path: string | null;
  version: string | null;
  downloading?: boolean;
}

export interface CheckerOptions {
  /** Custom bin directory (default: ~/.linkdown/bin or %APPDATA%/LinkDown/bin) */
  binDir?: string;
  /** Skip auto-download, only check */
  checkOnly?: boolean;
  /** Callback when download completes */
  onReady?: (path: string) => void;
  /** Callback for download progress */
  onProgress?: (percent: number) => void;
}

// ── Platform helpers ────────────────────────────────────────────────────────

function getPlatformKey(): string {
  return platform(); // "win32", "darwin", "linux"
}

function getBinDir(custom?: string): string {
  if (custom) return custom;
  const override = env.LINKDOWN_BIN_DIR;
  if (override) return override;

  const key = getPlatformKey();
  if (key === "win32") {
    return join(env.APPDATA || join(homedir(), "AppData", "Roaming"), "LinkDown", "bin");
  }
  return join(homedir(), ".linkdown", "bin");
}

function getFfmpegFilename(): string {
  return getPlatformKey() === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

function getDownloadUrl(): string | null {
  const key = getPlatformKey();
  const archKey = arch();

  if (key === "win32") {
    return "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
  }
  if (key === "darwin") {
    return archKey === "arm64"
      ? "https://evermeet.cx/ffmpeg/getrelease/zip/arm"
      : "https://evermeet.cx/ffmpeg/getrelease/zip";
  }
  if (key === "linux") {
    return "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";
  }
  return null;
}

// ── Detection ───────────────────────────────────────────────────────────────

const SYSTEM_SEARCH_PATHS: Record<string, string[]> = {
  win32: [
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
    join(env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages", "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe", "ffmpeg.exe"),
    join(env.USERPROFILE || "", "scoop", "shims", "ffmpeg.exe"),
  ],
  darwin: ["/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"],
  linux: ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/snap/bin/ffmpeg"],
};

/**
 * Search for ffmpeg binary in known locations.
 */
export function findFfmpeg(): string | null {
  // 1. Environment override
  const envPath = env.FFMPEG_PATH;
  if (envPath && existsSync(envPath)) {
    return envPath;
  }

  // 2. App-local bin directory
  const localPath = join(getBinDir(), getFfmpegFilename());
  if (existsSync(localPath)) {
    return localPath;
  }

  // 3. System paths
  const key = getPlatformKey();
  for (const p of SYSTEM_SEARCH_PATHS[key] || []) {
    if (p && existsSync(p)) {
      return p;
    }
  }

  // 4. PATH lookup
  try {
    const which = key === "win32" ? "where" : "which";
    const result = execSync(`${which} ffmpeg 2>/dev/null`, { encoding: "utf-8" }).trim();
    if (result && existsSync(result.split("\n")[0])) {
      return result.split("\n")[0];
    }
  } catch {
    // Not found in PATH
  }

  return null;
}

/**
 * Get FFmpeg version string.
 */
export function getFfmpegVersion(ffmpegPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(ffmpegPath, ["-version"], { timeout: 5000 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const firstLine = stdout.split("\n")[0];
      const parts = firstLine.split(" ");
      resolve(parts.length >= 3 ? parts[2] : firstLine);
    });
  });
}

/**
 * Quick check: is FFmpeg accessible?
 */
export function isFfmpegAvailable(): boolean {
  return findFfmpeg() !== null;
}

// ── Download ────────────────────────────────────────────────────────────────

/**
 * Download a file from URL to disk with progress callback.
 */
async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (percent: number) => void,
): Promise<boolean> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const total = Number(response.headers.get("content-length")) || 0;
    if (!response.body) {
      throw new Error("No response body");
    }

    const fileStream = createWriteStream(dest);
    const reader = response.body.getReader();
    let downloaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      fileStream.write(value);
      downloaded += value.length;

      if (total > 0 && onProgress) {
        onProgress(Math.round((downloaded / total) * 100));
      }
    }

    fileStream.end();
    return true;
  } catch (error) {
    console.error("[dependency-checker] Download failed:", error);
    return false;
  }
}

/**
 * Extract ffmpeg from a ZIP archive (Windows/macOS).
 */
async function extractFromZip(zipPath: string, binDir: string): Promise<string | null> {
  const ffmpegName = getFfmpegFilename();
  const finalPath = join(binDir, ffmpegName);

  try {
    // Use Node.js built-in or system unzip
    if (getPlatformKey() === "win32") {
      // PowerShell extraction
      execSync(
        `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${binDir}' -Force"`,
        { timeout: 60000 },
      );
    } else {
      execSync(`unzip -o "${zipPath}" -d "${binDir}"`, { timeout: 60000 });
    }

    // Find the extracted ffmpeg binary
    const files = readdirSync(binDir, { recursive: true });
    for (const f of files) {
      const fullPath = typeof f === "string" ? join(binDir, f) : join(binDir, f.toString());
      if (fullPath.endsWith("ffmpeg") || fullPath.endsWith("ffmpeg.exe")) {
        if (fullPath !== finalPath) {
          renameSync(fullPath, finalPath);
        }
        chmodSync(finalPath, 0o755);
        return finalPath;
      }
    }
  } catch (error) {
    console.error("[dependency-checker] ZIP extraction failed:", error);
  }
  return null;
}

/**
 * Download and install FFmpeg for the current platform.
 */
export async function downloadFfmpeg(options: CheckerOptions = {}): Promise<string | null> {
  const url = getDownloadUrl();
  if (!url) {
    console.error("[dependency-checker] No download URL for platform:", getPlatformKey());
    return null;
  }

  const binDir = getBinDir(options.binDir);
  mkdirSync(binDir, { recursive: true });

  const ext = getPlatformKey() === "linux" ? ".tar.xz" : ".zip";
  const tempFile = join(binDir, `ffmpeg_download${ext}`);

  try {
    console.log("[dependency-checker] Downloading FFmpeg from:", url);
    const success = await downloadFile(url, tempFile, options.onProgress);
    if (!success) return null;

    console.log("[dependency-checker] Extracting...");
    let ffmpegPath: string | null = null;

    if (ext === ".zip") {
      ffmpegPath = await extractFromZip(tempFile, binDir);
    } else {
      // tar.xz — use system tar
      execSync(`tar -xf "${tempFile}" -C "${binDir}" --strip-components=0`, { timeout: 60000 });
      const ffmpegName = getFfmpegFilename();
      ffmpegPath = join(binDir, ffmpegName);
      if (existsSync(ffmpegPath)) {
        chmodSync(ffmpegPath, 0o755);
      } else {
        ffmpegPath = null;
      }
    }

    // Clean up archive
    try {
      unlinkSync(tempFile);
    } catch {
      // ignore
    }

    if (ffmpegPath) {
      // Add to current process PATH
      addToProcessPath(binDir);

      // Update permanent PATH on Windows
      if (getPlatformKey() === "win32") {
        addToPermanentPath(binDir);
      }

      console.log("[dependency-checker] FFmpeg installed:", ffmpegPath);
      options.onReady?.(ffmpegPath);
    }

    return ffmpegPath;
  } catch (error) {
    console.error("[dependency-checker] Installation failed:", error);
    try {
      const { unlinkSync } = await import("fs");
      unlinkSync(tempFile);
    } catch {
      // ignore
    }
    return null;
  }
}

// ── PATH management ─────────────────────────────────────────────────────────

/**
 * Add a directory to the current process PATH.
 */
export function addToProcessPath(directory: string): void {
  const current = env.PATH || "";
  if (!current.includes(directory)) {
    const sep = getPlatformKey() === "win32" ? ";" : ":";
    env.PATH = directory + sep + current;
    console.log("[dependency-checker] Added to PATH:", directory);
  }
}

/**
 * Add directory to the user's permanent PATH (Windows only).
 * Modifies the registry and broadcasts WM_SETTINGCHANGE.
 */
export function addToPermanentPath(directory: string): boolean {
  if (getPlatformKey() !== "win32") return true;

  try {
    // Read current PATH from registry
    const result = execSync(
      'reg query "HKCU\\Environment" /v Path 2>nul',
      { encoding: "utf-8" },
    );

    const match = result.match(/Path\s+REG_EXPAND_SZ\s+(.+)/);
    if (!match) return false;

    const currentPath = match[1].trim();
    if (currentPath.includes(directory)) return true;

    const newPath = currentPath + ";" + directory;
    execSync(`reg add "HKCU\\Environment" /v Path /t REG_EXPAND_SZ /d "${newPath}" /f`, {
      encoding: "utf-8",
    });

    console.log("[dependency-checker] Added to permanent PATH:", directory);
    return true;
  } catch (error) {
    console.error("[dependency-checker] Failed to update permanent PATH:", error);
    return false;
  }
}

// ── Startup check ───────────────────────────────────────────────────────────

/**
 * Run FFmpeg dependency check on startup.
 *
 * Non-blocking: if FFmpeg is missing, downloads in background and calls onReady.
 *
 * @example
 * ```ts
 * // In Electron main process:
 * const ffmpegPath = await checkDependencies({
 *   onReady: (path) => console.log("FFmpeg ready:", path),
 *   onProgress: (pct) => console.log(`Downloading: ${pct}%`),
 * });
 * ```
 */
export async function checkDependencies(
  options: CheckerOptions = {},
): Promise<DependencyStatus> {
  // Quick check
  const existing = findFfmpeg();
  if (existing) {
    const version = await getFfmpegVersion(existing);
    console.log("[dependency-checker] FFmpeg available:", existing, `(v${version || "?"})`);
    return { available: true, path: existing, version };
  }

  // Not found
  if (options.checkOnly) {
    return { available: false, path: null, version: null };
  }

  // Download in background (non-blocking)
  console.log("[dependency-checker] FFmpeg not found — starting background download...");

  // Fire and forget — don't await
  downloadFfmpeg(options).then((path) => {
    if (path) {
      console.log("[dependency-checker] Background download complete:", path);
    } else {
      console.error("[dependency-checker] Background download failed");
    }
  });

  return { available: false, path: null, version: null, downloading: true };
}

/**
 * Get dependency status for health endpoint.
 */
export async function getDependencyStatus(): Promise<Record<string, DependencyStatus>> {
  const ffmpegPath = findFfmpeg();
  const ffmpegStatus: DependencyStatus = ffmpegPath
    ? { available: true, path: ffmpegPath, version: await getFfmpegVersion(ffmpegPath) }
    : { available: false, path: null, version: null };

  return { ffmpeg: ffmpegStatus };
}
