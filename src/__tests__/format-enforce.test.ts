import { describe, it, expect } from "vitest";
import {
  filterFormats,
  buildFormatSelector,
  mp4FormatWithHeight,
  isAllowedExtension,
  getMimeType,
  MP4_FORMAT_SELECTOR,
  MP3_FORMAT_SELECTOR,
  type FormatLike,
} from "@/lib/format-enforce";

// ── Fixtures ─────────────────────────────────────────────────────────

function fmt(id: string, opts: Partial<FormatLike> = {}): FormatLike {
  return {
    format_id: id,
    ext: "mp4",
    resolution: "1280x720",
    vcodec: "avc1.64001f",
    acodec: "mp4a.40.2",
    filesize: null,
    fps: 30,
    tbr: 2000,
    ...opts,
  };
}

/** A realistic YouTube-style ladder: progressive + DASH + audio. */
const LADDER: FormatLike[] = [
  fmt("18", { resolution: "640x360", tbr: 600 }), // progressive 360p
  fmt("22", { resolution: "1280x720", tbr: 1100 }), // progressive 720p
  fmt("137", { resolution: "1920x1080", acodec: null, tbr: 2500 }), // video-only
  fmt("f299", { resolution: "1920x1080", tbr: 2600 }), // YouTube DASH id
  fmt("248", { ext: "webm", resolution: "1920x1080", tbr: 2400 }), // webm container
  fmt("140", { ext: "m4a", resolution: "audio", vcodec: null, tbr: 130 }), // audio m4a
  fmt("251", { ext: "webm", resolution: "audio", vcodec: null, tbr: 160 }), // webm audio
  fmt("250", { ext: "mp3", resolution: "audio", vcodec: null, tbr: 96 }), // mp3 audio
];

// ── filterFormats ────────────────────────────────────────────────────

describe("filterFormats — strict MP4/MP3 only", () => {
  it("keeps only progressive MP4 formats, sorted by height desc", () => {
    const out = filterFormats(LADDER);
    expect(out.progressiveMp4.map((f) => f.format_id)).toEqual(["22", "18"]);
    expect(out.bestMp4Id).toBe("22");
  });

  it("keeps only m4a/mp3 audio formats", () => {
    const out = filterFormats(LADDER);
    expect(out.audioFormats.map((f) => f.format_id)).toEqual(["140", "250"]);
  });

  it("rejects video-only tracks (no audio codec → silent video)", () => {
    const out = filterFormats(LADDER);
    const ids = [...out.progressiveMp4, ...out.audioFormats].map(
      (f) => f.format_id,
    );
    expect(ids).not.toContain("137");
  });

  it("rejects YouTube DASH format ids (f299 pattern)", () => {
    const out = filterFormats([fmt("f299", { resolution: "1920x1080" })]);
    expect(out.progressiveMp4).toHaveLength(0);
    expect(out.bestMp4Id).toBe("best");
  });

  it("rejects blocked containers even when both codecs are present", () => {
    const out = filterFormats([
      fmt("248", { ext: "webm", vcodec: "vp9", acodec: "opus" }),
      fmt("30", { ext: "mkv" }),
      fmt("m4s1", { ext: "m4s" }),
      fmt("i1", { ext: "mhtml" }),
    ]);
    expect(out.progressiveMp4).toHaveLength(0);
    expect(out.audioFormats).toHaveLength(0);
  });

  it("rejects merge selectors like 22+bestaudio", () => {
    const out = filterFormats([
      fmt("22+bestaudio", { resolution: "1920x1080" }),
      fmt("bestvideo+bestaudio", { resolution: "1920x1080" }),
    ]);
    expect(out.progressiveMp4).toHaveLength(0);
  });

  it("rejects audio formats that also carry a video track", () => {
    const out = filterFormats([
      fmt("140", { ext: "m4a", vcodec: "avc1", resolution: "audio" }),
    ]);
    expect(out.audioFormats).toHaveLength(0);
  });

  it("sorts video by height first, then bitrate", () => {
    const out = filterFormats([
      fmt("a", { resolution: "1280x720", tbr: 900 }),
      fmt("b", { resolution: "1920x1080", tbr: 1000 }),
      fmt("c", { resolution: "1280x720", tbr: 1300 }), // same height, higher tbr
    ]);
    expect(out.progressiveMp4.map((f) => f.format_id)).toEqual(["b", "c", "a"]);
    expect(out.bestMp4Id).toBe("b");
  });

  it("sorts audio by bitrate descending", () => {
    const out = filterFormats([
      fmt("low", { ext: "mp3", vcodec: null, resolution: "audio", tbr: 64 }),
      fmt("high", { ext: "m4a", vcodec: null, resolution: "audio", tbr: 256 }),
    ]);
    expect(out.audioFormats.map((f) => f.format_id)).toEqual(["high", "low"]);
    expect(out.bestAudioId).toBe("high");
  });

  it("falls back to best/bestaudio when nothing survives the filter", () => {
    const out = filterFormats([]);
    expect(out.progressiveMp4).toEqual([]);
    expect(out.audioFormats).toEqual([]);
    expect(out.bestMp4Id).toBe("best");
    expect(out.bestAudioId).toBe("bestaudio");
  });
});

// ── Selector builders ────────────────────────────────────────────────

describe("buildFormatSelector", () => {
  it("audio-only mode always returns the MP3 selector", () => {
    expect(buildFormatSelector("22", true, true)).toBe(MP3_FORMAT_SELECTOR);
    expect(buildFormatSelector("best", true, false)).toBe(MP3_FORMAT_SELECTOR);
  });

  it("\"best\" returns the strict MP4 selector with or without ffmpeg", () => {
    expect(buildFormatSelector("best", false, true)).toBe(MP4_FORMAT_SELECTOR);
    expect(buildFormatSelector("best", false, false)).toBe(MP4_FORMAT_SELECTOR);
  });

  it("specific format + ffmpeg prefers it merged with bestaudio", () => {
    const s = buildFormatSelector("137", false, true);
    expect(s.startsWith("137+bestaudio/")).toBe(true);
    // Single-file fallback must require an audio codec (no silent file).
    expect(s).toContain("best[ext=mp4][acodec!=none]");
  });

  it("specific format without ffmpeg keeps the acodec guard", () => {
    const s = buildFormatSelector("137", false, false);
    expect(s).toBe(
      "137[ext=mp4][acodec!=none]/best[ext=mp4][acodec!=none]/best[ext=mp4]/mp4",
    );
  });
});

describe("MP4_FORMAT_SELECTOR invariants (regression: silent files)", () => {
  it("never filters merge terms on acodec (the shipped silent-video bug)", () => {
    const mergeTerms = MP4_FORMAT_SELECTOR.split("/").filter((t) =>
      t.includes("+"),
    );
    expect(mergeTerms.length).toBeGreaterThan(0);
    for (const term of mergeTerms) {
      expect(term).not.toContain("acodec!=none");
    }
  });

  it("single-file fallbacks require an audio codec", () => {
    expect(MP4_FORMAT_SELECTOR).toContain("best[ext=mp4][acodec!=none]");
  });

  it("MP3 selector targets bestaudio", () => {
    expect(MP3_FORMAT_SELECTOR).toContain("bestaudio");
    expect(MP3_FORMAT_SELECTOR).not.toContain("bestvideo");
  });
});

describe("mp4FormatWithHeight", () => {
  it("caps every height-specific term with the requested value", () => {
    const s = mp4FormatWithHeight(720);
    const capped = s.split("/").filter((t) => t.includes("[height<="));
    expect(capped.length).toBeGreaterThanOrEqual(5);
    for (const term of capped) expect(term).toContain("[height<=720]");
    expect(s).not.toContain("[height<=721]");
  });

  it("keeps an uncapped last-resort tail for direct https://media.mp4 URLs", () => {
    // A plain direct link exposes a single format with no height and no
    // codec info — every [height<=…] term rejects it, so the tail must
    // exist (documented in format-enforce.ts).
    expect(mp4FormatWithHeight(1080).endsWith("best[ext=mp4]/best")).toBe(true);
  });

  it("does not leak another cap's height", () => {
    expect(mp4FormatWithHeight(480)).not.toContain("720");
    expect(mp4FormatWithHeight(480)).toContain("[height<=480]");
  });
});

// ── Helpers ──────────────────────────────────────────────────────────

describe("isAllowedExtension", () => {
  it("accepts mp4 / mp3 / m4a case-insensitively", () => {
    expect(isAllowedExtension("mp4")).toBe(true);
    expect(isAllowedExtension("MP4")).toBe(true);
    expect(isAllowedExtension("mp3")).toBe(true);
    expect(isAllowedExtension("M4A")).toBe(true);
  });

  it("rejects every other container", () => {
    for (const ext of ["webm", "mkv", "m4s", "mhtml", "avi", "", "exe"]) {
      expect(isAllowedExtension(ext)).toBe(false);
    }
  });
});

describe("getMimeType", () => {
  it("maps the three allowed extensions", () => {
    expect(getMimeType("video.mp4")).toBe("video/mp4");
    expect(getMimeType("song.mp3")).toBe("audio/mpeg");
    expect(getMimeType("audio.m4a")).toBe("audio/mp4");
  });

  it("defaults to video/mp4 for unknown or missing extensions", () => {
    expect(getMimeType("file.unknown")).toBe("video/mp4");
    expect(getMimeType("noextension")).toBe("video/mp4");
  });

  it("is case-insensitive", () => {
    expect(getMimeType("Clip.MP3")).toBe("audio/mpeg");
  });
});
