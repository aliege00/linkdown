// Unit tests for the desktop format rules (electron/formats.cjs).
// The regression this guards: a direct media link (plain https://…/clip.mp4)
// is reported by yt-dlp with vcodec/acodec === null, and dropping those made
// every direct link analyze to "no formats" — nothing downloadable.
import { describe, it, expect } from "vitest";
import formats from "./formats.cjs";

const { isUsableFormat, mapFormat, pickBestFormatId } = formats;

const DIRECT_MP4 = {
  format_id: "mp4",
  url: "https://cdn.example.com/clip.mp4",
  ext: "mp4",
  protocol: "https",
  video_ext: "mp4",
  audio_ext: "none",
  vcodec: null,
  acodec: null,
  resolution: "640x360",
  width: 640,
  height: 360,
  filesize: 991017,
  direct: true,
};

const YOUTUBE_VIDEO_ONLY = {
  format_id: "137",
  ext: "mp4",
  vcodec: "avc1.640028",
  acodec: "none",
  height: 1080,
  width: 1920,
  tbr: 4000,
};

const YOUTUBE_AUDIO_ONLY = {
  format_id: "140",
  ext: "m4a",
  vcodec: "none",
  acodec: "mp4a.40.2",
  abr: 128,
  filesize: 3_000_000,
};

const YOUTUBE_PROGRESSIVE = {
  format_id: "18",
  ext: "mp4",
  vcodec: "avc1.42001E",
  acodec: "mp4a.40.2",
  height: 360,
  width: 640,
};

describe("isUsableFormat", () => {
  it("keeps a direct media file whose codecs are unknown (null)", () => {
    expect(isUsableFormat(DIRECT_MP4)).toBe(true);
  });

  it("keeps real video-only and audio-only streams", () => {
    expect(isUsableFormat(YOUTUBE_VIDEO_ONLY)).toBe(true);
    expect(isUsableFormat(YOUTUBE_AUDIO_ONLY)).toBe(true);
  });

  it("drops text-only formats (explicit none codecs)", () => {
    expect(
      isUsableFormat({ format_id: "sb0", ext: "mhtml", vcodec: "none", acodec: "none" }),
    ).toBe(false);
    expect(
      isUsableFormat({ format_id: "en", ext: "vtt", vcodec: "none", acodec: "none" }),
    ).toBe(false);
  });

  it("drops entries with no media extension at all", () => {
    expect(isUsableFormat({ format_id: "x", ext: "", vcodec: null, acodec: null })).toBe(false);
  });
});

describe("mapFormat", () => {
  it("normalizes 'none' codecs to null and keeps unknown null codecs", () => {
    const mapped = mapFormat(DIRECT_MP4);
    expect(mapped.vcodec).toBeNull();
    expect(mapped.acodec).toBeNull();
    expect(mapped.ext).toBe("mp4");
    expect(mapped.resolution).toBe("640x360");
    expect(mapped.filesize).toBe(991017);
  });

  it("maps a video-only stream with its resolution and bitrate", () => {
    const mapped = mapFormat(YOUTUBE_VIDEO_ONLY);
    expect(mapped.vcodec).toBe("avc1.640028");
    expect(mapped.acodec).toBeNull();
    expect(mapped.resolution).toBe("1920x1080");
  });
});

describe("pickBestFormatId", () => {
  it("returns the direct file's own format id instead of the generic 'best'", () => {
    expect(pickBestFormatId([DIRECT_MP4])).toBe("mp4");
  });

  it("prefers the highest progressive stream when both codecs are present", () => {
    expect(pickBestFormatId([YOUTUBE_PROGRESSIVE, YOUTUBE_AUDIO_ONLY])).toBe("18");
  });

  it("falls back to the highest video-only stream when no progressive exists", () => {
    expect(pickBestFormatId([YOUTUBE_AUDIO_ONLY, YOUTUBE_VIDEO_ONLY])).toBe("137");
  });

  it("falls back to 'best' when there is nothing usable", () => {
    expect(pickBestFormatId([])).toBe("best");
    expect(pickBestFormatId([{ ext: "vtt", vcodec: "none", acodec: "none" }])).toBe("best");
    expect(pickBestFormatId(null)).toBe("best");
  });
});