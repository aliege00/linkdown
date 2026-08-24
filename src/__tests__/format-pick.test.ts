import { describe, it, expect } from "vitest";
import {
  QUALITY_PRESETS,
  pickFormatForPreset,
} from "@/lib/format-pick";
import type { YtDlpFormat } from "@/lib/ytdlp";

function fmt(
  id: string,
  resolution: string,
  opts: Partial<YtDlpFormat> = {},
): YtDlpFormat {
  return {
    format_id: id,
    ext: "mp4",
    resolution,
    filesize: null,
    vcodec: "avc1",
    acodec: "mp4a",
    fps: 30,
    tbr: 2000,
    ...opts,
  };
}

const FORMATS: YtDlpFormat[] = [
  // Combined video+audio
  fmt("18", "640x360", { tbr: 600 }),
  fmt("22", "1280x720", { tbr: 1100 }),
  // Video-only ladder (needs ffmpeg merge)
  fmt("137", "1920x1080", { acodec: null, tbr: 2500 }),
  fmt("266", "3840x2160", { acodec: null, tbr: 9000 }),
  // Audio-only
  fmt("140", "", { vcodec: null, resolution: "audio", tbr: 130 }),
];

const INFO = {
  formats: FORMATS,
  best_format_id: "266+140",
  best_audio_format_id: "140",
};

describe("QUALITY_PRESETS", () => {
  it("exposes the five standard presets", () => {
    expect(QUALITY_PRESETS.map((p) => p.id)).toEqual([
      "best",
      "1080p",
      "720p",
      "480p",
      "audio",
    ]);
  });
});

describe("pickFormatForPreset", () => {
  it("best → server-provided combo", () => {
    expect(pickFormatForPreset(INFO, "best")).toBe("266+140");
  });

  it("audio → best audio stream", () => {
    expect(pickFormatForPreset(INFO, "audio")).toBe("140");
  });

  it("audio falls back to first audio-only when no id provided", () => {
    const info = { ...INFO, best_audio_format_id: null };
    expect(pickFormatForPreset(info, "audio")).toBe("140");
  });

  it("1080p picks the combined-or-video-only stream at/under the cap", () => {
    // No combined 1080p exists → video-only 137 wins.
    expect(pickFormatForPreset(INFO, "1080p")).toBe("137");
  });

  it("720p prefers a combined stream at the cap", () => {
    expect(pickFormatForPreset(INFO, "720p")).toBe("22");
  });

  it("480p picks the highest stream under the cap (360p combined)", () => {
    expect(pickFormatForPreset(INFO, "480p")).toBe("18");
  });

  it("degrades to smallest offered height when nothing fits the cap", () => {
    const info = {
      formats: [fmt("a", "2560x1440"), fmt("b", "3840x2160")],
      best_format_id: "b+140",
      best_audio_format_id: null,
    };
    // 480p requested but only 2K/4K exist → smallest (1440p) chosen.
    expect(pickFormatForPreset(info, "480p")).toBe("a");
  });

  it("falls back to overall best when no video formats exist", () => {
    const info = {
      formats: [fmt("140", "", { vcodec: null })],
      best_format_id: "140",
      best_audio_format_id: "140",
    };
    expect(pickFormatForPreset(info, "1080p")).toBe("140");
  });
});
