/**
 * Client-Side Video Extractor (Cobalt / Seal approach)
 *
 * Extracts video metadata and provides download capabilities
 * entirely on the client side — no server required.
 *
 * Flow:
 *   1. URL → oEmbed API (title, thumbnail, provider)
 *   2. URL → native plugin (on-device yt-dlp → formats + stream URLs)
 *   3. Fallback: direct browser download via fetch + blob
 *
 * On Android APK / Windows EXE, the native plugin does the heavy lifting.
 * In the browser preview, this module provides metadata-only extraction
 * and opens the URL for the user to download via browser extensions or
 * other tools.
 */

// ── oEmbed metadata (works for YouTube, Vimeo, and many others) ───────

interface OEmbedResponse {
  title?: string;
  thumbnail_url?: string;
  provider_name?: string;
  width?: number;
  height?: number;
}

const OEMBED_PATTERN: Array<{ pattern: RegExp; endpoint: string }> = [
  {
    pattern: /(?:youtube\.com|youtu\.be)/i,
    endpoint: "https://www.youtube.com/oembed",
  },
  {
    pattern: /vimeo\.com/i,
    endpoint: "https://vimeo.com/api/oembed.json",
  },
  {
    pattern: /tiktok\.com/i,
    endpoint: "https://www.tiktok.com/oembed",
  },
];

/**
 * Fetch video metadata via oEmbed — works in any browser, no API key needed.
 * Returns basic info (title, thumbnail, provider) or null if the URL
 * doesn't match any known oEmbed provider.
 */
export async function fetchOEmbedInfo(
  url: string,
): Promise<OEmbedResponse | null> {
  const match = OEMBED_PATTERN.find((p) => p.pattern.test(url));
  if (!match) return null;

  try {
    const resp = await fetch(
      `${match.endpoint}?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// ── Platform detection ────────────────────────────────────────────────

export type Platform =
  | "youtube"
  | "tiktok"
  | "instagram"
  | "twitter"
  | "vimeo"
  | "dailymotion"
  | "facebook"
  | "twitch"
  | "reddit"
  | "soundcloud"
  | "generic";

const PLATFORM_DETECTORS: Array<{ platform: Platform; pattern: RegExp }> = [
  { platform: "youtube", pattern: /(?:youtube\.com|youtu\.be)/i },
  { platform: "tiktok", pattern: /tiktok\.com/i },
  { platform: "instagram", pattern: /instagram\.com/i },
  { platform: "twitter", pattern: /(?:twitter\.com|x\.com)/i },
  { platform: "vimeo", pattern: /vimeo\.com/i },
  { platform: "dailymotion", pattern: /dailymotion\.com/i },
  { platform: "facebook", pattern: /(?:facebook\.com|fb\.watch)/i },
  { platform: "twitch", pattern: /twitch\.tv/i },
  { platform: "reddit", pattern: /(?:reddit\.com|redd\.it)/i },
  { platform: "soundcloud", pattern: /soundcloud\.com/i },
];

export function detectPlatform(url: string): Platform {
  return (
    PLATFORM_DETECTORS.find((d) => d.pattern.test(url))?.platform ?? "generic"
  );
}

// ── Client-side download (browser fallback) ───────────────────────────

/**
 * Trigger a browser download when no native engine is available.
 * Works for direct video URLs (mp4, webm, etc.) — the browser will
 * save the file to the default Downloads folder.
 *
 * For URLs that require extraction (e.g. YouTube watch pages), this
 * opens the URL in a new tab so the user can use a browser extension
 * or share it to the native app.
 */
export function triggerBrowserDownload(url: string, filename?: string): void {
  // If it's a direct media URL (ends with .mp4, .webm, etc.), download it
  const isDirectMedia = /\.(mp4|webm|mkv|avi|mov|mp3|m4a|ogg|opus|flac)(\?|$)/i.test(url);

  if (isDirectMedia) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } else {
    // Not a direct URL — open in new tab (user can share to app)
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/**
 * Download a URL as a blob and trigger a browser save.
 * Useful when the server returns a video stream that can be
 * fetched client-side (CORS permitting).
 */
export async function downloadAsBlob(
  url: string,
  filename: string = "video.mp4",
  onProgress?: (percent: number) => void,
): Promise<boolean> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!resp.ok) return false;

    const contentLength = parseInt(resp.headers.get("content-length") ?? "0", 10);
    const reader = resp.body?.getReader();
    if (!reader) return false;

    const chunks: ArrayBuffer[] = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      received += value.length;
      if (contentLength > 0) {
        onProgress?.(Math.round((received / contentLength) * 100));
      }
    }

    const blob = new Blob(chunks);
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);

    return true;
  } catch {
    return false;
  }
}
