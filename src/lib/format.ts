/**
 * Shared formatting helpers.
 *
 * Both the HTTP yt-dlp client (`ytdlp.ts`) and the native bridge
 * (`ytdlp-native.ts`) need identical `formatDuration` and `formatSize`
 * functions.  Keeping them in a single module avoids drift and makes
 * testing trivial.
 */

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
