/**
 * Quality-preset → concrete-format matching.
 *
 * Lets users pick a preferred quality (Best / 1080p / 720p / 480p / Audio)
 * BEFORE analyzing a URL. Once format details arrive, {@link pickFormatForPreset}
 * maps the chosen preset onto the closest real format the source offers.
 */

import type { YtDlpInfo, YtDlpFormat } from "./ytdlp";

export type QualityPresetId = "best" | "1080p" | "720p" | "480p" | "audio";

export interface QualityPreset {
  id: QualityPresetId;
  label: string;
  desc: string;
  /** Max video height in px (undefined = no cap / audio-only). */
  maxHeight?: number;
}

/** Shared by the pre-analysis chip bar and playlist downloads. */
export const QUALITY_PRESETS: QualityPreset[] = [
  { id: "best", label: "Best", desc: "Best available" },
  { id: "1080p", label: "1080p", desc: "Full HD + audio", maxHeight: 1080 },
  { id: "720p", label: "720p", desc: "HD + audio", maxHeight: 720 },
  { id: "480p", label: "480p", desc: "SD + audio", maxHeight: 480 },
  { id: "audio", label: "Audio", desc: "MP3 / M4A" },
];

/** "1920x1080" | "1080p" | "hd720" → 1080, else null. */
function parseHeight(resolution: string): number | null {
  if (!resolution) return null;
  const m = resolution.match(/(\d{3,4})\s*p\b/i) ?? resolution.match(/x(\d{3,4})\b/);
  return m ? parseInt(m[1], 10) : null;
}

function isAudioOnly(f: YtDlpFormat): boolean {
  return !f.vcodec && !!f.acodec;
}

function hasVideo(f: YtDlpFormat): boolean {
  return !!f.vcodec;
}

/**
 * Choose the format id that best satisfies the user's preset.
 *
 * - best  → server-provided best combo
 * - audio → best audio stream (falls back to best overall)
 * - NNNp  → highest-quality stream at or under NNNp, preferring combined
 *           video+audio; falls back to progressively looser matches and
 *           ultimately to the server's best so a download always exists.
 */
export function pickFormatForPreset(
  info: Pick<YtDlpInfo, "formats" | "best_format_id" | "best_audio_format_id">,
  preset: QualityPresetId,
): string {
  if (preset === "best") return info.best_format_id;

  if (preset === "audio") {
    if (info.best_audio_format_id) return info.best_audio_format_id;
    const audio = info.formats.find(isAudioOnly);
    return audio?.format_id || info.best_format_id;
  }

  const target = QUALITY_PRESETS.find((p) => p.id === preset)?.maxHeight ?? null;
  if (!target) return info.best_format_id;

  // Prefer combined video+audio streams (play everywhere without ffmpeg).
  const combined = info.formats.filter(
    (f) => hasVideo(f) && !!f.acodec,
  );
  // Video-only next (downloader appends +bestaudio when ffmpeg exists).
  const videoOnly = info.formats.filter((f) => hasVideo(f) && !f.acodec);

  const candidates = [
    ...combined.map((f) => ({ f, priority: 0 })),
    ...videoOnly.map((f) => ({ f, priority: 1 })),
  ].filter(({ f }) => {
    const h = parseHeight(f.resolution);
    return h !== null && h <= target;
  });

  if (candidates.length > 0) {
    // Highest height wins the user's quality intent; ties prefer combined
    // streams, then higher bitrate.
    return candidates.reduce((a, b) => {
      const ha = parseHeight(a.f.resolution) ?? 0;
      const hb = parseHeight(b.f.resolution) ?? 0;
      if (hb !== ha) return hb > ha ? b : a;
      if (b.priority !== a.priority) return b.priority < a.priority ? b : a;
      return (b.f.tbr ?? 0) > (a.f.tbr ?? 0) ? b : a;
    }).f.format_id;
  }

  // Nothing at/below the cap (e.g. only 1440p sources exist) — degrade to
  // the smallest offered height rather than surprising the user with 4K.
  const all = [...combined, ...videoOnly];
  if (all.length > 0) {
    return all.reduce((a, b) =>
      (parseHeight(a.resolution) ?? 0) <= (parseHeight(b.resolution) ?? 0) ? a : b,
    ).format_id;
  }

  return info.best_format_id;
}
