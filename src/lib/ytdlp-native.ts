/**
 * Native yt-dlp Bridge
 *
 * Replaces the old HTTP-based yt-dlp server client with direct
 * calls to the Android native YtDlp Capacitor plugin.
 *
 * When running in a browser/non-native environment, falls back
 * gracefully with descriptive messages.
 */

import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

interface YtDlpPluginInterface {
  extractInfo(options: { url: string }): Promise<any>;
  startDownload(options: { url: string; formatId: string }): Promise<{ workId: string }>;
  cancelDownload(options: { workId: string }): Promise<void>;
  openFile(options: { uri: string }): Promise<{ success: boolean }>;
  getDownloads(): Promise<{ downloads: DownloadEntry[] }>;
  pickFolder(): Promise<DownloadLocation>;
  getDownloadLocation(): Promise<DownloadLocation>;
  resetDownloadLocation(): Promise<void>;
  addListener(eventName: string, callback: (data: any) => void): Promise<PluginListenerHandle>;
}

export interface YtDlpFormat {
  format_id: string;
  ext: string;
  resolution: string;
  filesize: number | null;
  vcodec: string | null;
  acodec: string | null;
  fps: number | null;
  tbr: number | null;
}

export interface YtDlpInfo {
  success: true;
  id: string;
  title: string;
  duration: number | null;
  thumbnail: string | null;
  uploader: string;
  uploader_url: string | null;
  webpage_url: string;
  formats: YtDlpFormat[];
  best_format_id: string;
  best_audio_format_id: string | null;
  ffmpeg_available: boolean;
}

export interface YtDlpError {
  success: false;
  error: string;
}

export type YtDlpResult = YtDlpInfo | YtDlpError;

/** A file saved to the device's Downloads folder. */
export interface DownloadEntry {
  uri: string;
  name: string;
  mime: string;
  size: number | null;
  date: number | null;
}

/** Payload emitted by the native foreground service when a download finishes. */
export interface CompletedDownload {
  uri: string;
  fileName: string;
}

/** The user's chosen download folder (SAF tree URI). */
export interface DownloadLocation {
  uri: string;
  name: string;
  isDefault?: boolean;
}

type ProgressCallback = (data: {
  percent: number;
  speed: string;
  eta: string;
  downloadedBytes?: number;
  totalBytes?: number;
}) => void;

const YtDlp = registerPlugin<YtDlpPluginInterface>("YtDlp");

/** Desktop (Electron EXE) bridge — exposed by electron/preload.cjs. */
export interface DesktopBridge {
  isDesktop: boolean;
  getVideoInfo(options: { url: string }): Promise<YtDlpResult>;
  startDownload(options: { url: string; formatId: string }): Promise<{ success: boolean; workId?: string; error?: string }>;
  cancelDownload(options: { token: string }): Promise<{ success: boolean }>;
  openFile(options: { filePath: string }): Promise<{ success: boolean }>;
  getDownloads(): Promise<{ downloads: DownloadEntry[] }>;
  getDownloadLocation(): Promise<DownloadLocation>;
  pickFolder(): Promise<DownloadLocation | null>;
  resetDownloadLocation(): Promise<DownloadLocation>;
  onProgress(cb: (data: any) => void): () => void;
  onComplete(cb: (data: any) => void): () => void;
  onError(cb: (data: any) => void): () => void;
}

const Desktop = (window as any).vidfetch as DesktopBridge | undefined;

let progressListeners: Map<string, ProgressCallback> = new Map();
let nativeAvailable: boolean | null = null;

/**
 * Check if a download engine is available in this environment.
 * True in the Android APK (Capacitor plugin) and the Windows EXE
 * (window.vidfetch bridge). False in a plain browser preview.
 */
export function isNativeAvailable(): boolean {
  if (nativeAvailable !== null) return nativeAvailable;

  if (Desktop?.isDesktop) {
    nativeAvailable = true;
    return true;
  }

  try {
    const capacitor = (window as any).Capacitor;
    nativeAvailable = !!(capacitor && capacitor.isNativePlatform());
  } catch {
    nativeAvailable = false;
  }
  return nativeAvailable;
}

/**
 * Extract video metadata and available formats from a URL.
 * Uses the native YtDlp plugin when available, falls back gracefully.
 */
export async function getVideoInfo(url: string): Promise<YtDlpResult> {
  if (!isNativeAvailable()) {
    return {
      success: false,
      error: "The download engine only exists inside the Android APK and the Windows EXE. " +
        "Install one of those — no server, no API key, unlimited.",
    };
  }

  if (Desktop?.isDesktop) {
    try {
      return await Desktop.getVideoInfo({ url });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to extract video info",
      };
    }
  }

  try {
    const result = await YtDlp.extractInfo({ url });

    return result as YtDlpInfo;
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to extract video info",
    };
  }
}

/**
 * Start downloading a video using the native foreground service.
 * Returns a work ID that can be used to cancel the download.
 *
 * Progress callbacks are throttled to ~10/sec so rapid yt-dlp progress
 * lines don't cause janky re-renders.
 *
 * @param url         Video URL to download
 * @param formatId    Format ID from getVideoInfo (default: "best")
 * @param onProgress  Optional callback for real-time progress updates
 * @param onComplete  Optional callback fired when the native service finishes
 * @param onError     Optional callback fired when the download fails/cancels
 * @returns           Work ID string, or null if native unavailable
 */
export async function startDownload(
  url: string,
  formatId: string = "best",
  onProgress?: ProgressCallback,
  onComplete?: (info: CompletedDownload) => void,
  onError?: (error: string) => void
): Promise<string | null> {
  if (!isNativeAvailable()) {
    console.warn("[ytdlp-native] Native engine not available");
    return null;
  }

  // Desktop (EXE) path — events arrive through the preload bridge.
  if (Desktop?.isDesktop) {
    try {
      const offs: Array<() => void> = [];
      if (onProgress) {
        let lastEmit = 0;
        offs.push(
          Desktop.onProgress((data: any) => {
            const now = Date.now();
            if (now - lastEmit < 100) return;
            lastEmit = now;
            onProgress({
              percent: data.percent ?? 0,
              speed: data.speed ?? "0",
              eta: data.eta ?? "--:--",
            });
          }),
        );
      }
      if (onComplete) {
        offs.push(
          Desktop.onComplete((data: any) => {
            offs.forEach((off) => off());
            onComplete({ uri: data.uri ?? "", fileName: data.fileName ?? "" });
          }),
        );
      }
      if (onError) {
        offs.push(
          Desktop.onError((data: any) => {
            offs.forEach((off) => off());
            onError(data.error ?? "Download failed");
          }),
        );
      }
      const res = await Desktop.startDownload({ url, formatId });
      if (!res.success) {
        offs.forEach((off) => off());
        onError?.(res.error ?? "Download failed");
        return null;
      }
      return res.workId ?? null;
    } catch (error) {
      console.error("[ytdlp-native] desktop startDownload failed:", error);
      return null;
    }
  }

  try {
    const handles: PluginListenerHandle[] = [];

    // Register progress listener if callback provided
    if (onProgress) {
      let lastEmit = 0;
      const handle = await YtDlp.addListener("downloadProgress", (data: any) => {
        const now = Date.now();
        if (now - lastEmit < 100) return; // max ~10 updates/sec
        lastEmit = now;
        onProgress({
          percent: data.percent ?? 0,
          speed: data.speed ?? "0",
          eta: data.eta ?? "--:--",
        });
      });
      handles.push(handle);
    }

    // Register completion listener — carries the saved file URI
    if (onComplete) {
      const handle = await YtDlp.addListener("downloadComplete", (data: any) => {
        onComplete({
          uri: data.uri ?? "",
          fileName: data.fileName ?? "",
        });
        handles.forEach((h) => h.remove());
      });
      handles.push(handle);
    }

    // Register error listener
    if (onError) {
      const handle = await YtDlp.addListener("downloadError", (data: any) => {
        onError(data.error ?? "Download failed");
        handles.forEach((h) => h.remove());
      });
      handles.push(handle);
    }

    const result = await YtDlp.startDownload({ url, formatId });
    return result.workId ?? null;
  } catch (error) {
    console.error("[ytdlp-native] startDownload failed:", error);
    return null;
  }
}

/**
 * Cancel an active download.
 */
export async function cancelDownload(workId?: string): Promise<void> {
  if (!isNativeAvailable()) return;

  if (Desktop?.isDesktop) {
    try {
      await Desktop.cancelDownload({ token: workId ?? "" });
    } catch (error) {
      console.error("[ytdlp-native] desktop cancelDownload failed:", error);
    }
    return;
  }

  try {
    await YtDlp.cancelDownload({ workId: workId ?? "" });
  } catch (error) {
    console.error("[ytdlp-native] cancelDownload failed:", error);
  }
}

/**
 * Open a downloaded file with the system's default viewer.
 */
export async function openFile(uri: string): Promise<boolean> {
  if (!isNativeAvailable() || !uri) return false;

  if (Desktop?.isDesktop) {
    try {
      const res = await Desktop.openFile({ filePath: uri });
      return !!res.success;
    } catch (error) {
      console.error("[ytdlp-native] desktop openFile failed:", error);
      return false;
    }
  }

  try {
    await YtDlp.openFile({ uri });
    return true;
  } catch (error) {
    console.error("[ytdlp-native] openFile failed:", error);
    return false;
  }
}

/**
 * List files saved to the device's Downloads folder (default + custom),
 * newest first. Returns an empty array outside the native app.
 */
export async function getDownloads(): Promise<DownloadEntry[]> {
  if (!isNativeAvailable()) return [];

  if (Desktop?.isDesktop) {
    try {
      const result = await Desktop.getDownloads();
      return result.downloads ?? [];
    } catch (error) {
      console.error("[ytdlp-native] desktop getDownloads failed:", error);
      return [];
    }
  }

  try {
    const result = await YtDlp.getDownloads();
    return result.downloads ?? [];
  } catch (error) {
    console.error("[ytdlp-native] getDownloads failed:", error);
    return [];
  }
}

/**
 * Open the system folder picker and save the user's choice.
 * Resolves with the picked location, or null if cancelled/unsupported.
 */
export async function pickFolder(): Promise<DownloadLocation | null> {
  if (!isNativeAvailable()) return null;

  if (Desktop?.isDesktop) {
    try {
      return await Desktop.pickFolder();
    } catch (error) {
      console.log("[ytdlp-native] desktop pickFolder:", error);
      return null;
    }
  }

  try {
    return await YtDlp.pickFolder();
  } catch (error) {
    // Cancelled by the user — not an error worth logging loudly
    console.log("[ytdlp-native] pickFolder:", error);
    return null;
  }
}

/**
 * Get the current download folder (default when no custom one is set).
 */
export async function getDownloadLocation(): Promise<DownloadLocation | null> {
  if (!isNativeAvailable()) return null;

  if (Desktop?.isDesktop) {
    try {
      return await Desktop.getDownloadLocation();
    } catch (error) {
      console.error("[ytdlp-native] desktop getDownloadLocation failed:", error);
      return null;
    }
  }

  try {
    return await YtDlp.getDownloadLocation();
  } catch (error) {
    console.error("[ytdlp-native] getDownloadLocation failed:", error);
    return null;
  }
}

/**
 * Reset downloads back to the default Downloads/VidFetch folder.
 */
export async function resetDownloadLocation(): Promise<void> {
  if (!isNativeAvailable()) return;

  if (Desktop?.isDesktop) {
    try {
      await Desktop.resetDownloadLocation();
    } catch (error) {
      console.error("[ytdlp-native] desktop resetDownloadLocation failed:", error);
    }
    return;
  }

  try {
    await YtDlp.resetDownloadLocation();
  } catch (error) {
    console.error("[ytdlp-native] resetDownloadLocation failed:", error);
  }
}

/**
 * Format a duration in seconds to a human-readable string.
 */
export function formatDuration(seconds: number | null): string {
  if (!seconds) return "--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Format a file size in bytes to a human-readable string.
 */
export function formatSize(bytes: number | null): string {
  if (!bytes) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
