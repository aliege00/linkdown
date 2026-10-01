import { describe, it, expect } from "vitest";
import {
  DOWNLOAD_MODES,
  selectorForMode,
  approxMbPerMinute,
  estimateSizeMb,
  type DownloadModeId,
} from "@/lib/download-modes";
import {
  MP4_FORMAT_SELECTOR,
  MP3_FORMAT_SELECTOR,
  mp4FormatWithHeight,
} from "@/lib/format-enforce";

// ─── Mode table ────────────────────────────────────────────────────────

describe("DOWNLOAD_MODES", () => {
  it("exposes exactly best / data / audio in order", () => {
    expect(DOWNLOAD_MODES.map((m) => m.id)).toEqual(["best", "data", "audio"]);
  });

  it("marks exactly one mode as recommended (Data Saver)", () => {
    const recommended = DOWNLOAD_MODES.filter((m) => m.recommended);
    expect(recommended).toHaveLength(1);
    expect(recommended[0].id).toBe("data");
  });

  it("caps height only on the data mode (480p)", () => {
    for (const mode of DOWNLOAD_MODES) {
      if (mode.id === "data") expect(mode.maxHeight).toBe(480);
      else expect(mode.maxHeight).toBeUndefined();
    }
  });

  it("carries bilingual labels and a plain-language description for every mode", () => {
    for (const mode of DOWNLOAD_MODES) {
      expect(mode.label.length).toBeGreaterThan(0);
      expect(mode.labelEn.length).toBeGreaterThan(0);
      expect(mode.descTr.length).toBeGreaterThan(0);
      expect(mode.descEn.length).toBeGreaterThan(0);
      expect(mode.emoji.length).toBeGreaterThan(0);
    }
  });
});

// ─── Selector chains ───────────────────────────────────────────────────
// The mode chips map 1:1 onto the strict format-enforce chains — a drift
// between the two modules would silently change what the UI downloads.

describe("selectorForMode", () => {
  it("best mode uses the strict MP4 chain with a final any-container fallback", () => {
    // Locks the exact chain: merge terms (no acodec filter), then a
    // acodec-guaranteed single-file term, then last-ditch fallbacks so the
    // chips never fail a download outright.
    expect(selectorForMode("best")).toBe(
      "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/" +
        "bestvideo[ext=mp4]+bestaudio[ext=m4a]/" +
        "bestvideo+bestaudio/" +
        "best[ext=mp4][acodec!=none]/best[acodec!=none]/best[ext=mp4]/best",
    );
  });

  it("data mode uses the 480p-capped chain with guaranteed-audio fallbacks", () => {
    // Same merge terms as mp4FormatWithHeight(480), but BOTH single-file
    // terms require an audio codec and two extra last-ditch fallbacks are
    // appended so the default mode NEVER fails where the preset would.
    expect(selectorForMode("data")).toBe(
      "bestvideo[ext=mp4][vcodec^=avc1][height<=480]+bestaudio[ext=m4a]/" +
        "bestvideo[ext=mp4][height<=480]+bestaudio[ext=m4a]/" +
        "bestvideo[height<=480]+bestaudio/" +
        "best[ext=mp4][height<=480][acodec!=none]/" +
        "best[height<=480][acodec!=none]/" +
        "best[ext=mp4]/best",
    );
  });

  it("audio mode uses the strict audio selector", () => {
    expect(selectorForMode("audio")).toBe(MP3_FORMAT_SELECTOR);
  });

  it("never falls back below the audio guarantee on the audio mode", () => {
    const chain = selectorForMode("audio").split("/");
    // Every audio-mode term keeps an audio stream; the chain ends with a
    // bare bestaudio so audio ALWAYS downloads.
    for (const term of chain) {
      expect(term.startsWith("bestaudio")).toBe(true);
    }
    expect(chain[chain.length - 1]).toBe("bestaudio");
  });

  it("merge terms never filter on acodec (silent-file rule, video part)", () => {
    for (const mode of ["best", "data"] as const) {
      for (const term of selectorForMode(mode).split("/")) {
        if (term.includes("bestvideo")) {
          // Video-only streams have acodec=none BY DESIGN — filtering the
          // merge terms on it eliminated every candidate (v2.5.0 bug).
          expect(term).not.toContain("acodec");
          // Merge terms must pair video with audio.
          expect(term).toContain("+bestaudio");
        }
      }
    }
  });

  it("height-caps every merge term on the data mode", () => {
    for (const term of selectorForMode("data").split("/")) {
      if (term.includes("bestvideo")) {
        expect(term).toContain("[height<=480]");
      }
    }
  });

  it("leaves merge terms uncapped on the best mode", () => {
    for (const term of selectorForMode("best").split("/")) {
      if (term.includes("bestvideo")) {
        expect(term).not.toContain("[height<=");
      }
    }
  });

  it("keeps the acodec-filtered single-file term before the last-ditch fallbacks", () => {
    // The first single-file (non-merge) MP4 term must require an audio
    // codec so a silent file is only ever possible on the very last resort.
    for (const mode of ["best", "data"] as const) {
      const singleFile = selectorForMode(mode)
        .split("/")
        .filter((t) => !t.includes("bestvideo") && t.startsWith("best["));
      expect(singleFile.length).toBeGreaterThan(0);
      expect(singleFile[0]).toContain("acodec!=none");
    }
  });
});

// ─── Size estimates ────────────────────────────────────────────────────

describe("approxMbPerMinute", () => {
  it("returns the documented per-mode rates", () => {
    expect(approxMbPerMinute("audio")).toBe(1);
    expect(approxMbPerMinute("data")).toBe(7);
    expect(approxMbPerMinute("best")).toBe(25);
  });
});

describe("estimateSizeMb", () => {
  it("returns null without a usable duration", () => {
    expect(estimateSizeMb("data", null)).toBeNull();
    expect(estimateSizeMb("data", undefined)).toBeNull();
    expect(estimateSizeMb("data", 0)).toBeNull();
    expect(estimateSizeMb("data", -5)).toBeNull();
  });

  it("estimates minutes × mode rate for a single video", () => {
    // 10 min data-saver video: 10 × 7 = 70 MB
    expect(estimateSizeMb("data", 600)).toBe(70);
    // 10 min best-quality video: 10 × 25 = 250 MB
    expect(estimateSizeMb("best", 600)).toBe(250);
    // 10 min audio: 10 × 1 = 10 MB
    expect(estimateSizeMb("audio", 600)).toBe(10);
  });

  it("multiplies by the playlist count", () => {
    // 3 videos × 10 min × 7 MB/min
    expect(estimateSizeMb("data", 600, 3)).toBe(210);
  });

  it("defaults count to 1 and rounds to whole MB", () => {
    // 90 s audio = 1.5 min × 1 MB → 2 (rounded)
    expect(estimateSizeMb("audio", 90)).toBe(2);
    expect(estimateSizeMb("audio", 90, 1)).toBe(2);
  });

  it("handles fractional seconds", () => {
    // 30 s data = 0.5 min × 7 = 3.5 → 4 (rounded)
    expect(estimateSizeMb("data", 30)).toBe(4);
  });
});

// ─── Type-level sanity ─────────────────────────────────────────────────

describe("DownloadModeId", () => {
  it("only accepts the three documented ids", () => {
    const ids: DownloadModeId[] = ["best", "data", "audio"];
    expect(ids).toHaveLength(DOWNLOAD_MODES.length);
  });
});
