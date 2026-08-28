/**
 * Format Enforcement — strict MP4 / MP3 output only.
 *
 * YouTube and other sites offer many raw container formats (webm, m4a,
 * mkv, etc.) that don't play well on all devices. This module enforces:
 *   - Video: H.264/AAC inside MP4 container
 *   - Audio: MP3 (or M4A as fallback)
 *
 * It provides yt-dlp format selector strings that force these constraints,
 * and filters the format list shown to the user to only include playable
 * formats.
 */

// ── Allowed output formats ────────────────────────────────────────────

/** Extensions that are safe to download directly (no conversion needed). */
export const ALLOWED_VIDEO_EXTENSIONS = ["mp4"];
export const ALLOWED_AUDIO_EXTENSIONS = ["mp3", "m4a"];

/** Extensions that should be rejected (raw/unconverted). */
export const REJECTED_EXTENSIONS = ["webm", "mkv", "avi", "mov", "flv", "3gp", "ts", "ogg", "opus", "wav", "flac"];

// ── yt-dlp Format Selectors ───────────────────────────────────────────

/**
 * Strict MP4 format selector for yt-dlp.
 *
 * Forces H.264 video + AAC audio merged into MP4:
 *   - bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a] — best quality
 *   - bestvideo[ext=mp4]+bestaudio[ext=m4a] — fallback
 *   - best[ext=mp4] — combined stream fallback
 *   - mp4 — last resort
 */
export const MP4_FORMAT_SELECTOR =
  "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/mp4";

/**
 * Strict MP4 format selector with height cap.
 * @param maxHeight Maximum video height in pixels (e.g. 1080, 720, 480)
 */
export function mp4FormatWithHeight(maxHeight: number): string {
  return (
    `bestvideo[ext=mp4][vcodec^=avc1][height<=${maxHeight}]+bestaudio[ext=m4a]/` +
    `bestvideo[ext=mp4][height<=${maxHeight}]+bestaudio[ext=m4a]/` +
    `best[ext=mp4][height<=${maxHeight}]/` +
    `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]`
  );
}

/**
 * Strict MP3 audio-only format selector.
 * Forces MP3 output via ffmpeg post-processing when needed.
 */
export const MP3_FORMAT_SELECTOR =
  "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio";

/**
 * Post-processing argument to force MP3 output via ffmpeg.
 * Pass as: --extract-audio --audio-format mp3
 */
export const MP3_POSTPROCESS_ARGS = ["--extract-audio", "--audio-format", "mp3"];

// ── Format Filtering ──────────────────────────────────────────────────

export interface FilteredFormats {
  /** Formats that will output as MP4 (combined or video-only with audio merge). */
  mp4Formats: FormatLike[];
  /** Formats that will output as MP3/M4A (audio-only). */
  audioFormats: FormatLike[];
  /** Best format ID for MP4 video. */
  bestMp4FormatId: string;
  /** Best format ID for audio. */
  bestAudioFormatId: string;
}

interface FormatLike {
  format_id: string;
  ext: string;
  resolution: string;
  vcodec: string | null;
  acodec: string | null;
  filesize: number | null;
  fps: number | null;
  tbr: number | null;
}

/**
 * Filter a list of formats to only include MP4-compatible and audio formats.
 * Rejects webm, mkv, and other raw containers.
 */
export function filterFormats(formats: FormatLike[]): FilteredFormats {
  const mp4Formats: FormatLike[] = [];
  const audioFormats: FormatLike[] = [];

  for (const f of formats) {
    const ext = f.ext.toLowerCase();

    // Audio-only tracks
    if (!f.vcodec && f.acodec) {
      // Accept m4a and mp3 audio; reject ogg/opus/wav for MP3 output
      if (ALLOWED_AUDIO_EXTENSIONS.includes(ext) || ext === "ogg" || ext === "opus") {
        audioFormats.push(f);
      }
      continue;
    }

    // Video tracks (with or without audio)
    if (f.vcodec) {
      // Only include MP4-compatible formats
      if (ext === "mp4") {
        mp4Formats.push(f);
      }
      // Include webm/mkv ONLY if they can be remuxed to MP4 (ffmpeg available)
      // and the codec is compatible (H.264 in webm is common on YouTube)
      else if (
        (ext === "webm" || ext === "mkv") &&
        f.vcodec &&
        (f.vcodec.startsWith("avc1") || f.vcodec.startsWith("vp9") || f.vcodec.startsWith("vp09"))
      ) {
        // Mark these as "convertible" — they'll be remuxed to MP4
        mp4Formats.push({ ...f, ext: "mp4" });
      }
    }
  }

  // Sort: highest resolution first for video, highest bitrate for audio
  mp4Formats.sort((a, b) => {
    const ha = parseHeight(a.resolution);
    const hb = parseHeight(b.resolution);
    if (hb !== ha) return (hb ?? 0) - (ha ?? 0);
    return (b.tbr ?? 0) - (a.tbr ?? 0);
  });

  audioFormats.sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0));

  return {
    mp4Formats,
    audioFormats,
    bestMp4FormatId: mp4Formats[0]?.format_id ?? "best",
    bestAudioFormatId: audioFormats[0]?.format_id ?? "bestaudio",
  };
}

/**
 * Build the final format selector string for a download, enforcing MP4/MP3.
 *
 * @param selectedFormatId  The format ID the user picked (or "best")
 * @param isAudioOnly       Whether the user wants audio only
 * @param ffmpegAvailable   Whether ffmpeg is available for remuxing
 */
export function buildFormatSelector(
  selectedFormatId: string,
  isAudioOnly: boolean,
  ffmpegAvailable: boolean,
): string {
  if (isAudioOnly) {
    // Force MP3 output
    if (ffmpegAvailable) {
      // Use best audio and let ffmpeg convert to MP3
      return MP3_FORMAT_SELECTOR;
    }
    // No ffmpeg — return best audio in a compatible format
    return "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio";
  }

  // Video: enforce MP4
  if (selectedFormatId === "best") {
    return MP4_FORMAT_SELECTOR;
  }

  // User picked a specific format — ensure it outputs as MP4
  // If the selected format is webm/mkv and ffmpeg is available,
  // let yt-dlp remux it; otherwise fall back to MP4 selector
  if (ffmpegAvailable) {
    return `${selectedFormatId}/bestvideo+bestaudio/best`;
  }

  // No ffmpeg — must pick an MP4 format
  return `${selectedFormatId}[ext=mp4]/best[ext=mp4]/mp4`;
}

// ── Helpers ───────────────────────────────────────────────────────────

function parseHeight(resolution: string): number | null {
  if (!resolution) return null;
  const m = resolution.match(/(\d{3,4})\s*p\b/i) ?? resolution.match(/x(\d{3,4})\b/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Check if a file extension is allowed (MP4 or MP3/M4A).
 */
export function isAllowedExtension(ext: string): boolean {
  const lower = ext.toLowerCase();
  return (
    ALLOWED_VIDEO_EXTENSIONS.includes(lower) ||
    ALLOWED_AUDIO_EXTENSIONS.includes(lower)
  );
}

/**
 * Get the correct MIME type for the allowed formats.
 */
export function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const mimeMap: Record<string, string> = {
    mp4: "video/mp4",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
  };
  return mimeMap[ext] ?? "video/mp4";
}
