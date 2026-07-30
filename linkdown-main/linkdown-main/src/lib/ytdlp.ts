/**
 * yt-dlp API Client
 * 
 * Communicates with the self-hosted yt-dlp FastAPI server to extract
 * video metadata and trigger downloads from 1000+ supported sites.
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

function getServerUrl(): string {
  return (import.meta as any).env.VITE_YTDLP_SERVER_URL || "";
}

/**
 * Extract video metadata and available formats from a URL.
 * Returns title, thumbnail, duration, and a curated list of formats.
 */
export async function getVideoInfo(url: string): Promise<YtDlpResult> {
  const baseUrl = getServerUrl();
  if (!baseUrl) {
    return {
      success: false,
      error:
        "No yt-dlp server URL configured. Set VITE_YTDLP_SERVER_URL in your environment.",
    };
  }

  try {
    const response = await fetch(
      `${baseUrl}/api/info?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(30000) },
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.detail || `Server responded with ${response.status}`,
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
 * Trigger a video download. Opens the download URL in a new tab
 * or triggers a browser download.
 */
export function downloadVideo(
  url: string,
  formatId: string = "best",
): string | null {
  const baseUrl = getServerUrl();
  if (!baseUrl) return null;

  const downloadUrl = `${baseUrl}/api/download?url=${encodeURIComponent(url)}&format_id=${encodeURIComponent(formatId)}`;

  // Open in a new tab (which will trigger the download)
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
