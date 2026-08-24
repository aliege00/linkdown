/**
 * yt-dlp API Client
 *
 * Communicates with the self-hosted yt-dlp FastAPI server (yt-dlp-server/) to
 * extract video metadata and trigger downloads from 1000+ supported sites.
 *
 * Supports both single videos and playlists:
 *   - getVideoInfo(url, isPlaylist) returns is_playlist + entries for playlists
 *   - downloadVideo(url, formatId, isPlaylist) downloads a whole playlist as a
 *     ZIP when isPlaylist is true
 */

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

/** A single video inside a playlist. */
export interface PlaylistEntry {
  id: string;
  title: string;
  url: string;
  duration: number | null;
  thumbnail: string | null;
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
  /** true when the analyzed URL resolved to a playlist */
  is_playlist?: boolean;
  /** number of videos in the playlist (when is_playlist) */
  count?: number | null;
  /** the videos inside the playlist (when is_playlist) */
  entries?: PlaylistEntry[];
}

export interface YtDlpError {
  success: false;
  error: string;
}

export type YtDlpResult = YtDlpInfo | YtDlpError;

export function getServerUrl(): string {
  return (import.meta as any).env.VITE_YTDLP_SERVER_URL || "";
}

/** True when a self-hosted yt-dlp server URL is configured. */
export function hasServer(): boolean {
  return !!getServerUrl();
}

/**
 * Extract video metadata and available formats from a URL.
 * Returns title, thumbnail, duration, and a curated list of formats.
 *
 * @param url        Video or playlist URL
 * @param isPlaylist Hint that the URL is a playlist. The server also detects
 *                   playlists itself from yt-dlp's response and returns
 *                   `is_playlist: true` with the playlist's entries.
 */
export async function getVideoInfo(
  url: string,
  isPlaylist: boolean = false,
): Promise<YtDlpResult> {
  const baseUrl = getServerUrl();
  if (!baseUrl) {
    return {
      success: false,
      error:
        "The download engine runs on your device — there is no server. Install the Android APK or Windows EXE; no API key or setup needed.",
    };
  }

  try {
    const response = await fetch(
      `${baseUrl}/api/info?url=${encodeURIComponent(url)}&is_playlist=${isPlaylist ? "true" : "false"}`,
      { signal: AbortSignal.timeout(30000) },
    );

    // Reverse proxies / error pages can return HTML — parse defensively so the
    // user sees a clear message instead of a cryptic JSON parse error.
    const data = (await response.json().catch(() => null)) as
      | (YtDlpInfo & { detail?: string })
      | { detail?: string }
      | null;

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail || `Server responded with ${response.status}`,
      };
    }

    if (!data || typeof data !== "object") {
      return {
        success: false,
        error: `yt-dlp server returned an invalid (non-JSON) response (${response.status})`,
      };
    }

    return data as YtDlpInfo;
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to connect to yt-dlp server",
    };
  }
}

/**
 * Trigger a video (or playlist) download. Opens the download URL in a new tab
 * or triggers a browser download.
 *
 * @param url        Video or playlist URL
 * @param formatId   yt-dlp format selector (default: "best")
 * @param isPlaylist When true, downloads the whole playlist and returns a ZIP
 * @returns the download URL, or null when no server is configured
 */
export function downloadVideo(
  url: string,
  formatId: string = "best",
  isPlaylist: boolean = false,
): string | null {
  const baseUrl = getServerUrl();
  if (!baseUrl) return null;

  const downloadUrl = `${baseUrl}/api/download?url=${encodeURIComponent(url)}&format_id=${encodeURIComponent(formatId)}&is_playlist=${isPlaylist ? "true" : "false"}`;

  // Trigger the browser download (works in iframes/previews too)
  const a = document.createElement("a");
  a.href = downloadUrl;
  a.download = "";
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  return downloadUrl;
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
