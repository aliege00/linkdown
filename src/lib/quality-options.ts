/**
 * Quality options derived from what a video ACTUALLY has.
 *
 * The old picker offered a fixed 1080p/720p/480p list, so a 360p-only clip
 * showed a "1080p" chip that silently downloaded 360p — the UI lied. Here the
 * list is built from the heights yt-dlp reported for THAT video, so every chip
 * corresponds to a real stream. Each chip maps to a height-capped selector
 * whose last-resort terms still resolve if a later link in the batch has
 * fewer streams than the one we sampled.
 */

import { MP4_FORMAT_SELECTOR, MP3_FORMAT_SELECTOR, mp4FormatWithHeight } from "./format-enforce";

export interface QualityFormatLike {
  ext?: string;
  resolution?: string;
  vcodec?: string | null;
  acodec?: string | null;
  height?: number | null;
  filesize?: number | null;
  /** Total bitrate in kbps, when the engine reports it. */
  tbr?: number | null;
}

export interface QualityOption {
  /** null = "best available" (no cap). */
  height: number | null;
  label: string;
  /** yt-dlp selector to send for this choice. */
  selector: string;
  /** How many real streams back this height (0 = the engine did not say). */
  streamCount: number;
}

/** Parse "1920x1080" / "1080p" / "audio only" into a height number. */
export function heightOf(format: QualityFormatLike): number | null {
  if (typeof format.height === "number" && format.height > 0) return format.height;
  const res = (format.resolution || "").toLowerCase();
  const match = res.match(/(\d+)\s*[xp]\b/) || res.match(/x(\d+)/);
  if (match) {
    const value = parseInt(match[1], 10);
    if (Number.isFinite(value) && value > 0 && value < 10_000) return value;
  }
  return null;
}

const label = (height: number) => (height >= 2160 ? `${height / 1000}K` : `${height}p`);

/**
 * Real, de-duplicated quality choices for one video, tallest first.
 *
 * - Only heights that a real video stream exists for are offered.
 * - "Best" is always first (un-capped selector).
 * - Audio-only is offered when the source has no video stream at all, or when
 *   the caller asks for it (a music link has nothing else to give).
 */
export function buildQualityOptions(
  formats: QualityFormatLike[],
  opts: { includeAudio?: boolean } = {},
): QualityOption[] {
  const list = formats ?? [];
  const buckets = new Map<number, number>();

  for (const f of list) {
    if (!f?.vcodec) continue; // audio-only or text format
    const h = heightOf(f);
    if (!h) continue;
    buckets.set(h, (buckets.get(h) ?? 0) + 1);
  }

  const heights = [...buckets.keys()].sort((a, b) => b - a).slice(0, 6);

  const options: QualityOption[] = [
    { height: null, label: "Best", selector: MP4_FORMAT_SELECTOR, streamCount: 0 },
  ];

  for (const h of heights) {
    options.push({
      height: h,
      label: label(h),
      selector: mp4FormatWithHeight(h),
      streamCount: buckets.get(h) ?? 0,
    });
  }

  const hasVideo = buckets.size > 0;
  if (opts.includeAudio || !hasVideo) {
    options.push({
      height: null,
      label: "Audio",
      selector: MP3_FORMAT_SELECTOR,
      streamCount: list.filter((f) => !!f?.acodec && !f?.vcodec).length,
    });
  }

  return options;
}

/**
 * The option to preselect: the tallest real height, or "Best" when the engine
 * reported nothing usable (keeps the default honest instead of guessing).
 */
export function defaultQualityOption(options: QualityOption[]): QualityOption {
  return options.find((o) => o.height !== null) ?? options[0];
}

// ─── Size estimation from REAL streams ───────────────────────────────────

export interface SelectionSize {
  bytes: number;
  /** true → every byte count came from the engine (show without "≈"). */
  exact: boolean;
}

/** Audio-only stream? (vcodec missing/"none" with a real audio codec). */
function isAudioFormat(f: QualityFormatLike): boolean {
  const v = (f.vcodec || "").toLowerCase();
  if (v && v !== "none") return false;
  const res = (f.resolution || "").toLowerCase();
  if (res.includes("audio")) return true;
  return !!(f.acodec && f.acodec !== "none");
}

/** Exact bytes when the engine reported a filesize, else bitrate × duration. */
function bytesFor(
  f: QualityFormatLike,
  durationSeconds: number | null,
): SelectionSize | null {
  if (typeof f.filesize === "number" && f.filesize > 0) {
    return { bytes: f.filesize, exact: true };
  }
  const kbps = typeof f.tbr === "number" && f.tbr > 0 ? f.tbr : null;
  if (kbps && durationSeconds) {
    return { bytes: Math.round((kbps * 1000 * durationSeconds) / 8), exact: false };
  }
  return null;
}

/** Best audio stream for an estimate — mirrors the m4a-first selector chain. */
function bestAudio(formats: QualityFormatLike[]): QualityFormatLike | null {
  const audio = formats.filter(isAudioFormat);
  return (
    audio.find((f) => f.ext === "m4a") ??
    audio.find((f) => f.ext === "mp4") ??
    audio[0] ??
    null
  );
}

/**
 * Estimate what the CURRENT selection will download, derived from the video's
 * REAL format list instead of a fixed MB-per-minute table.
 *
 * This is what keeps the numbers on screen honest: the format cards show the
 * engine's own file sizes, and this function picks the SAME streams those
 * cards offer — the tallest at or under `maxHeight` (or the audio track in
 * audio mode) — so the quality chips and the download button can never
 * disagree with a card by a factor of two.
 *
 * Returns null when nothing usable is known (no formats, or no size/bitrate
 * data and no duration), letting the caller fall back to its coarse table.
 */
export function estimateSelectionBytes(
  formats: QualityFormatLike[],
  opts: {
    /** User picked audio-only mode. */
    audioOnly?: boolean;
    /** Pinned height cap (the 1080p/720p/480p chips, or a mode's maxHeight). */
    maxHeight?: number | null;
    /** Needed only when a stream has no filesize but does have a bitrate. */
    durationSeconds?: number | null;
  } = {},
): SelectionSize | null {
  const list = (formats ?? []).filter(Boolean);
  if (list.length === 0) return null;
  const duration =
    opts.durationSeconds && opts.durationSeconds > 0 ? opts.durationSeconds : null;

  if (opts.audioOnly) {
    const pick = bestAudio(list);
    return pick ? bytesFor(pick, duration) : null;
  }

  const cap = opts.maxHeight && opts.maxHeight > 0 ? opts.maxHeight : null;
  const video = list.filter((f) => heightOf(f) !== null && !isAudioFormat(f));
  // Mirror the selector chain: prefer streams at or under the cap; when none
  // exists, estimate from the tallest available (that is what the chain
  // falls through to).
  const atOrBelow = cap ? video.filter((f) => (heightOf(f) ?? 0) <= cap) : video;
  const pool = atOrBelow.length > 0 ? atOrBelow : video;
  if (pool.length === 0) return null;

  let best = pool[0];
  for (const f of pool) {
    if ((heightOf(f) ?? 0) > (heightOf(best) ?? 0)) best = f;
  }

  const size = bytesFor(best, duration);
  const combined = !!best.acodec && best.acodec !== "none";
  if (combined || !size) return size;

  // Video-only DASH stream: the real file also needs the best audio track.
  const audio = bestAudio(list);
  const audioSize = audio ? bytesFor(audio, duration) : null;
  if (!audioSize) return size;
  return {
    bytes: size.bytes + audioSize.bytes,
    exact: size.exact && audioSize.exact,
  };
}