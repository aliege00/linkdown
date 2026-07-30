/**
 * Native yt-dlp Bridge
 *
 * Replaces the old HTTP-based yt-dlp server client with direct
 * calls to the Android native YtDlp Capacitor plugin.
 *
 * When running in a browser/non-native environment, falls back
 * gracefully with descriptive messages.
 */

import { registerPlugin } from "@capacitor/core";

interface YtDlpPluginInterface {
  extractInfo(options: { url: string }): Promise<any>;
  startDownload(options: { url: string; formatId: string }): Promise<{ workId: string }>;
  cancelDownload(options: { workId: string }): Promise<void>;
  addListener(eventName: string, callback: (data: any) => void): Promise<void>;
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

type ProgressCallback = (data: {
  percent: number;
  speed: string;
  eta: string;
  downloadedBytes?: number;
  totalBytes?: number;
}) => void;

const YtDlp = registerPlugin<YtDlpPluginInterface>("YtDlp");

let progressListeners: Map<string, ProgressCallback> = new Map();
let nativeAvailable: boolean | null = null;

/**
 * Check if the native YtDlp plugin is available in this environment.
 */
function isNativeAvailable(): boolean {
  if (nativeAvailable !== null) return nativeAvailable;

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
      error: "Native yt-dlp engine is not available in this environment. " +
        "Build and install the APK on your Android device to use on-device downloading.",
    };
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
 * @param url         Video URL to download
 * @param formatId    Format ID from getVideoInfo (default: "best")
 * @param onProgress  Optional callback for real-time progress updates
 * @returns           Work ID string, or null if native unavailable
 */
export async function startDownload(
  url: string,
  formatId: string = "best",
  onProgress?: ProgressCallback
): Promise<string | null> {
  if (!isNativeAvailable()) {
    console.warn("[ytdlp-native] Native engine not available");
    return null;
  }

  try {
    // Register progress listener if callback provided
    if (onProgress) {
      const listenerId = `dl_${Date.now()}`;
      progressListeners.set(listenerId, onProgress);

      YtDlp.addListener("downloadProgress", (data: any) => {
        onProgress({
          percent: data.percent ?? 0,
          speed: data.speed ?? "0",
          eta: data.eta ?? "--:--",
        });
      });
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

  try {
    await YtDlp.cancelDownload({ workId: workId ?? "" });
  } catch (error) {
    console.error("[ytdlp-native] cancelDownload failed:", error);
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
