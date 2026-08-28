/**
 * Format Enforcement — STRICT Progressive MP4 / MP3 only.
 *
 * This module ruthlessly filters out:
 *   - DASH / Adaptive streams (separate video + audio .m4s segments)
 *   - webm, mkv, m4a, mhtml, fXXX format IDs
 *   - Video-only tracks (no audio — causes silent video)
 *   - Audio-only tracks in non-MP3/M4A containers
 *
 * Only PASS-THROUGH formats are kept:
 *   - Progressive MP4 (H.264 video + AAC audio in one file)
 *   - MP3 audio
 *
 * This prevents crashes from selecting unplayable DASH segments and
 * ensures every format in the list is directly downloadable.
 */

// ── Allowed Extensions ────────────────────────────────────────────────

const STRICT_ALLOWED_VIDEO = new Set(["mp4"]);
const STRICT_ALLOWED_AUDIO = new Set(["mp3", "m4a"]);

/** Extensions that are NEVER allowed (raw/unconverted/DASH). */
const BLOCKED_EXTENSIONS = new Set([
  "webm", "mkv", "avi", "mov", "flv", "3gp", "ts", "ogg",
  "opus", "wav", "flac", "mhtml", "m4s", "m3u8", "mpd",
]);

// ── Format ID Patterns to Reject ──────────────────────────────────────

/**
 * YouTube format IDs that are DASH segments or adaptive streams.
 * These are NOT progressive and cause crashes or silent video.
 */
const DASH_FORMAT_PATTERNS = [
  /^f\d{2,3}$/,           // f137, f248, f251 etc. (YouTube DASH IDs)
  /\+bestaudio/,           // Merge selectors (handled by yt-dlp, not UI)
  /bestvideo/,             // Video-only selectors
  /bestaudio/,             // Audio-only selectors (when shown as video)
];

// ── Format Filtering ──────────────────────────────────────────────────

export interface FormatLike {
  format_id: string;
  ext: string;
  resolution: string;
  vcodec: string | null;
  acodec: string | null;
  filesize: number | null;
  fps: number | null;
  tbr: number | null;
}

export interface FilteredFormats {
  /** Progressive MP4 formats (combined video + audio). Ready to play. */
  progressiveMp4: FormatLike[];
  /** Audio-only formats (MP3, M4A). Ready to play. */
  audioFormats: FormatLike[];
  /** Best progressive MP4 format ID. */
  bestMp4Id: string;
  /** Best audio format ID. */
  bestAudioId: string;
}

/**
 * Check if a format is a DASH/adaptive segment that should be rejected.
 */
function isDashSegment(f: FormatLike): boolean {
  // Reject by extension
  const ext = f.ext.toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) return true;
  if (!STRICT_ALLOWED_VIDEO.has(ext) && !STRICT_ALLOWED_AUDIO.has(ext)) return true;

  // Reject by format ID pattern (YouTube DASH IDs)
  for (const pattern of DASH_FORMAT_PATTERNS) {
    if (pattern.test(f.format_id)) return true;
  }

  return false;
}

/**
 * Check if a format is a true Progressive MP4 (combined video + audio).
 * This is the ONLY video format we allow — it plays everywhere.
 */
function isProgressiveMp4(f: FormatLike): boolean {
  const ext = f.ext.toLowerCase();

  // Must be MP4 container
  if (!STRICT_ALLOWED_VIDEO.has(ext)) return false;

  // Must have BOTH video AND audio codecs (progressive = combined)
  if (!f.vcodec) return false;
  if (!f.acodec) return false;

  // Must NOT be a DASH segment
  if (isDashSegment(f)) return false;

  // Must have a playable resolution (not "audio" or empty)
  if (!f.resolution || f.resolution.toLowerCase() === "audio") return false;

  return true;
}

/**
 * Check if a format is a valid audio track (MP3 or M4A).
 */
function isAllowedAudio(f: FormatLike): boolean {
  const ext = f.ext.toLowerCase();

  // Must be in allowed audio extensions
  if (!STRICT_ALLOWED_AUDIO.has(ext)) return false;

  // Must have an audio codec
  if (!f.acodec) return false;

  // Must NOT have video (audio-only)
  if (f.vcodec) return false;

  // Must NOT be a DASH segment
  if (isDashSegment(f)) return false;

  return true;
}

/**
 * STRICT filter: only Progressive MP4 + MP3/M4A.
 *
 * This is the core function that eliminates ALL problematic formats:
 *   - DASH segments (.m4s, .m4a adaptive)
 *   - Video-only tracks (no audio — silent video)
 *   - webm/mkv containers (incompatible players)
 *   - mhtml downloads (not media at all)
 *   - fXXX format IDs (YouTube internal DASH IDs)
 */
export function filterFormats(formats: FormatLike[]): FilteredFormats {
  const progressiveMp4: FormatLike[] = [];
  const audioFormats: FormatLike[] = [];

  for (const f of formats) {
    if (isProgressiveMp4(f)) {
      progressiveMp4.push(f);
    } else if (isAllowedAudio(f)) {
      audioFormats.push(f);
    }
    // Everything else is REJECTED silently
  }

  // Sort: highest resolution first, then highest bitrate
  progressiveMp4.sort((a, b) => {
    const ha = parseHeight(a.resolution);
    const hb = parseHeight(b.resolution);
    if (hb !== ha) return (hb ?? 0) - (ha ?? 0);
    return (b.tbr ?? 0) - (a.tbr ?? 0);
  });

  // Sort audio: highest bitrate first
  audioFormats.sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0));

  return {
    progressiveMp4,
    audioFormats,
    bestMp4Id: progressiveMp4[0]?.format_id ?? "best",
    bestAudioId: audioFormats[0]?.format_id ?? "bestaudio",
  };
}

// ── yt-dlp Format Selectors ───────────────────────────────────────────

/**
 * Strict MP4 format selector for yt-dlp.
 * Forces: bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]
 * Falls back to combined progressive MP4.
 */
export const MP4_FORMAT_SELECTOR =
  "bestvideo[ext=mp4][vcodec^=avc1][acodec!=none]+bestaudio[ext=m4a]/" +
  "bestvideo[ext=mp4][acodec!=none]+bestaudio[ext=m4a]/" +
  "best[ext=mp4][vcodec^=avc1]/best[ext=mp4]/mp4";

/**
 * Strict MP4 format selector with height cap.
 */
export function mp4FormatWithHeight(maxHeight: number): string {
  return (
    `bestvideo[ext=mp4][vcodec^=avc1][height<=${maxHeight}][acodec!=none]+bestaudio[ext=m4a]/` +
    `bestvideo[ext=mp4][height<=${maxHeight}][acodec!=none]+bestaudio[ext=m4a]/` +
    `best[ext=mp4][height<=${maxHeight}]/` +
    `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]`
  );
}

/**
 * Strict MP3 audio-only selector.
 */
export const MP3_FORMAT_SELECTOR =
  "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio";

// ── Build Format Selector ─────────────────────────────────────────────

/**
 * Build the final yt-dlp format selector, enforcing MP4/MP3 only.
 */
export function buildFormatSelector(
  selectedFormatId: string,
  isAudioOnly: boolean,
  ffmpegAvailable: boolean,
): string {
  if (isAudioOnly) {
    return ffmpegAvailable ? MP3_FORMAT_SELECTOR : "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio";
  }

  if (selectedFormatId === "best") {
    return MP4_FORMAT_SELECTOR;
  }

  // For a specific format, ensure it's progressive MP4
  if (ffmpegAvailable) {
    return `${selectedFormatId}[acodec!=none]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]`;
  }
  return `${selectedFormatId}[ext=mp4][acodec!=none]/best[ext=mp4]/mp4`;
}

// ── Helpers ───────────────────────────────────────────────────────────

function parseHeight(resolution: string): number | null {
  if (!resolution) return null;
  const m = resolution.match(/(\d{3,4})\s*p\b/i) ?? resolution.match(/x(\d{3,4})\b/);
  return m ? parseInt(m[1], 10) : null;
}

export function isAllowedExtension(ext: string): boolean {
  const lower = ext.toLowerCase();
  return STRICT_ALLOWED_VIDEO.has(lower) || STRICT_ALLOWED_AUDIO.has(lower);
}

export function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const mimeMap: Record<string, string> = {
    mp4: "video/mp4",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
  };
  return mimeMap[ext] ?? "video/mp4";
}
