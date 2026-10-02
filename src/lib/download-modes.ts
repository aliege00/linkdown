/**
 * Download modes — the user-facing "how much data does this use" selector.
 *
 * Modes are deliberately described in plain language the way a person would
 * choose them ("En iyi kalite", "Veri dostu — az internet yer", "Sadece ses").
 * Internally each mode maps onto a strict yt-dlp format selector plus a
 * height cap; the sizes shown in the UI are ESTIMATES (bitrate × duration)
 * refined with real per-format filesize metadata when the engine reports it.
 */

export type DownloadModeId = "best" | "data" | "audio";

export interface DownloadMode {
  id: DownloadModeId;
  /** Short name shown on the chip. */
  label: string;
  labelEn: string;
  /** One-liner under the chip — plain Turkish/English, no jargon. */
  descTr: string;
  descEn: string;
  /** Max video height for the mode (undefined = no cap). */
  maxHeight?: number;
  /** Recommended default? (Data Saver — matches the "az veri" ask.) */
  recommended?: boolean;
  /** Emoji shown on the chip for instant recognition. */
  emoji: string;
}

export const DOWNLOAD_MODES: DownloadMode[] = [
  {
    id: "best",
    label: "En İyi",
    labelEn: "Best",
    descTr: "En iyi kalite — daha çok internet kullanır",
    descEn: "Best quality — uses more data",
    emoji: "✨",
  },
  {
    id: "data",
    label: "Veri Dostu",
    labelEn: "Data Saver",
    descTr: "Az internet yer — dosya boyutu küçük, internetsiz oynar",
    descEn: "Low data — small file, plays offline",
    maxHeight: 480,
    recommended: true,
    emoji: "📱",
  },
  {
    id: "audio",
    label: "Sadece Ses",
    labelEn: "Audio only",
    descTr: "En az internet — müzik/podcast için",
    descEn: "Least data — for music/podcasts",
    emoji: "🎧",
  },
];

/**
 * Format selector for a mode. Mirrors the audio-guarantee rules in
 * format-enforce.ts: merge terms never filter on acodec (video-only streams
 * have none by design), single-file fallbacks REQUIRE an audio codec so a
 * silent download is impossible.
 */
export function selectorForMode(mode: DownloadModeId): string {
  if (mode === "audio") {
    // M4A/AAC — universally playable, smallest per-minute size, and unlike
    // raw mp3 conversion it does NOT re-encode (no quality loss, no extra CPU).
    return "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio";
  }
  const cap = mode === "data" ? "[height<=480]" : "";
  return (
    `bestvideo[ext=mp4][vcodec^=avc1]${cap}+bestaudio[ext=m4a]/` +
    `bestvideo[ext=mp4]${cap}+bestaudio[ext=m4a]/` +
    `bestvideo${cap}+bestaudio/` +
    `best[ext=mp4]${cap}[acodec!=none]/best${cap}[acodec!=none]/best[ext=mp4]/best`
  );
}

/** Approximate MB per minute of video for the estimate chip. */
export function approxMbPerMinute(mode: DownloadModeId): number {
  if (mode === "audio") return 1; // ~128 kbps AAC ≈ 1 MB/min
  if (mode === "data") return 7; // ~950 kbps 480p H.264 ≈ 7 MB/min
  return 25; // best available (1080p-ish) ≈ 25 MB/min
}

/**
 * Approximate MB per minute for a PINNED exact height (the 1080p/720p/480p
 * picks in "Gelişmiş seçenekler"). Without this the estimate kept using the
 * mode chip even after the user pinned a quality, so the MB number never moved.
 *
 * Bitrate guesses (H.264 progressive): 480p ≈ 950 kbps, 720p ≈ 1600 kbps,
 * 1080p ≈ 3300 kbps → MB/min ≈ (kbps × 60) / 8000.
 */
export function approxMbPerMinuteForHeight(height: number): number {
  if (height <= 360) return 4; // ~540 kbps
  if (height <= 480) return 7; // ~950 kbps
  if (height <= 720) return 12; // ~1600 kbps
  return 25; // 1080p ≈ 3300 kbps; anything taller is capped here because
  //            only progressive MP4 is offered and yt-dlp rarely exposes
  //            reliable sizes for 4K progressive streams.
}

/**
 * Estimate the download size in MB for a video/playlist.
 * @param durationSeconds single video duration (or AVERAGE entry duration
 *                        for playlists — analyzed flat entries carry it)
 * @param count           number of videos (1 for single videos)
 */
export function estimateSizeMb(
  mode: DownloadModeId,
  durationSeconds: number | null | undefined,
  count: number = 1,
): number | null {
  if (!durationSeconds || durationSeconds <= 0) return null;
  const minutes = (durationSeconds * count) / 60;
  return Math.round(minutes * approxMbPerMinute(mode));
}
