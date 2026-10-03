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
 *
 * DATA_MODE_BITRATE_CAPS is what makes "use less internet" real rather than
 * cosmetic: a 1080p source has SEVERAL streams under 480p (360p, 240p,
 * 144p …) and yt-dlp's `best…[height<=480]` chain always picks the TALLEST
 * of them — the 480p one — even when it is 4× the bytes of the 360p stream
 * sitting right next to it. Adding progressive bitrate caps BEFORE the
 * height-only terms lets yt-dlp step down to a genuinely smaller stream
 * when the site offers one, while the old terms stay in the chain as
 * fallbacks so nothing ever fails to download.
 *
 * Caps are in kbps and deliberately generous for 480p-class video: they
 * only bite on the low-bitrate ladder, they do not degrade a normal 480p
 * stream (which is typically 500–1200 kbps).
 */
export function selectorForMode(mode: DownloadModeId): string {
  if (mode === "audio") {
    // M4A/AAC — universally playable, smallest per-minute size, and unlike
    // raw mp3 conversion it does NOT re-encode (no quality loss, no extra CPU).
    return "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio";
  }
  if (mode === "data") return dataModeSelector();
  return (
    "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/" +
    "bestvideo[ext=mp4]+bestaudio[ext=m4a]/" +
    "bestvideo+bestaudio/" +
    "best[ext=mp4][acodec!=none]/best[acodec!=none]/best[ext=mp4]/best"
  );
}

/**
 * Bitrate caps (kbps) tried, in order, before the height-only fallbacks.
 *
 * Every entry is a PREFERRED step, not a requirement: if a site has no
 * stream under a given cap, yt-dlp simply falls through to the next term.
 * The last two entries are deliberately generous so a genuinely
 * low-bitrate 480p source (common on reposts/old uploads) still resolves
 * without stepping down to 360p for no reason.
 */
export const DATA_MODE_BITRATE_CAPS = [600, 900, 1400] as const;

/**
 * The Data Saver selector: prefer the smallest stream that still looks
 * decent, and only then fall back to the plain height-capped chain.
 *
 * Term order is the whole point:
 *   1. bitrate-capped merge/single terms (≤600 → ≤900 → ≤1400 kbps)
 *   2. the historical [height<=480] chain, unchanged
 * so a source with a small 360p stream downloads that, while a source whose
 * only ≤480p option is 480p@1.2Mbps still downloads the 480p it would have
 * before.
 */
export function dataModeSelector(maxHeight = 480): string {
  const h = `[height<=${maxHeight}]`;
  const capped = DATA_MODE_BITRATE_CAPS.map(
    (kbps) => `[tbr<=${kbps}]`,
  ).join("");
  return (
    `bestvideo[ext=mp4][vcodec^=avc1]${h}${capped}+bestaudio[ext=m4a]/` +
    `bestvideo[ext=mp4]${h}${capped}+bestaudio[ext=m4a]/` +
    `bestvideo${h}${capped}+bestaudio/` +
    `best[ext=mp4]${h}${capped}[acodec!=none]/` +
    `bestvideo[ext=mp4][vcodec^=avc1]${h}+bestaudio[ext=m4a]/` +
    `bestvideo[ext=mp4]${h}+bestaudio[ext=m4a]/` +
    `bestvideo${h}+bestaudio/` +
    `best[ext=mp4]${h}[acodec!=none]/best${h}[acodec!=none]/best[ext=mp4]/best`
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
