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