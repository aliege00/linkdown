/**
 * Quality-chip regression tests.
 *
 * Shipped bug: the download screen offered hard-coded quality choices, so a
 * 360p-only clip showed a "1080p" option that silently downloaded 360p — and
 * a genuinely 1080p video showed no 1080p option when the progressive ladder
 * on screen topped out at 720p. Both directions of the lie come from the
 * same cause: options NOT derived from the video's real formats.
 *
 * `buildQualityOptions` is EXECUTED here (pure function, real streams), and
 * the card's chip row is pinned with source assertions.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildQualityOptions, defaultQualityOption } from "@/lib/quality-options";

const card = readFileSync(
  resolve(__dirname, "../components/DownloaderCard.tsx"),
  "utf-8",
);

function fmt(resolution: string, opts: { vcodec?: string | null; acodec?: string | null; height?: number } = {}) {
  return {
    resolution,
    vcodec: opts.vcodec ?? "avc1",
    acodec: opts.acodec ?? "mp4a",
    height: opts.height,
  };
}

describe("buildQualityOptions", () => {
  it("offers only the heights the video actually has", () => {
    const options = buildQualityOptions([
      fmt("640x360"),
      fmt("1280x720"),
    ]);
    expect(options.map((o) => o.label)).toEqual(["Best", "720p", "360p"]);
    // No 1080 chip exists when the source has no 1080 stream.
    expect(options.some((o) => o.height === 1080)).toBe(false);
  });

  it("shows 1080p when the source really has a 1080 stream", () => {
    const options = buildQualityOptions([
      fmt("1920x1080"),
      fmt("1280x720"),
      fmt("640x360"),
    ]);
    expect(options.map((o) => o.height)).toEqual([null, 1080, 720, 360]);
    expect(options[1].selector).toContain("height<=1080");
    expect(options[1].label).toBe("1080p");
  });

  it("always puts Best first, mapped to the un-capped selector", () => {
    const options = buildQualityOptions([fmt("1280x720")]);
    expect(options[0].height).toBeNull();
    expect(options[0].label).toBe("Best");
    expect(defaultQualityOption(options).height).toBe(720);
  });

  it("ignores audio-only and codec-less entries when counting heights", () => {
    const options = buildQualityOptions([
      { resolution: "audio only", vcodec: null, acodec: "mp4a" },
      { resolution: "", vcodec: null, acodec: null },
      // Audio stream carrying a resolution string: still not a height.
      { resolution: "640x360", vcodec: null, acodec: "mp4a" },
    ]);
    // No phantom heights: "Best" plus the honest Audio fallback that
    // buildQualityOptions always offers when there is no video ladder.
    expect(options.map((o) => o.label)).toEqual(["Best", "Audio"]);
    expect(options.some((o) => o.height !== null)).toBe(false);
  });

  it("caps the ladder so a 12-format page cannot become 12 chips", () => {
    const many = Array.from({ length: 12 }, (_, i) => fmt(`${1920 - i * 10}x${1080 - i * 10}`));
    const options = buildQualityOptions(many);
    expect(options.length).toBeLessThanOrEqual(7); // Best + ≤6 heights
  });
});

describe("DownloaderCard quality chips", () => {
  it("builds the chip row from the video's real formats", () => {
    expect(card).toContain(
      "buildQualityOptions(videoInfo.formats ?? [], { includeAudio: false })",
    );
    expect(card).toContain("qualityOptions.length > 1");
    expect(card).toContain("İndirme kalitesi");
    // A chip selects through its own selector — no hard-coded format id.
    expect(card).toContain("handleSelectFormat(opt.selector)");
  });

  it("lights the chip whose height the current selector targets", () => {
    // Mode, pin and chip selections all encode [height<=N].
    expect(card).toContain("selectedFormat.includes(`height<=${opt.height}`)");
    expect(card).toContain("selectedFormat === MP4_FORMAT_SELECTOR");
  });

  it("drops an exact-quality pin the video does not have", () => {
    // The advanced panel's fixed 1080/720/480 choice must not survive
    // analysis when the engine's ladder has no such rung — that is the
    // "1080 shows up but is not supported" lie.
    expect(card).toContain("const realHeights = new Set(");
    expect(card).toContain("mp4FormatWithHeight(pinned)");
    expect(card).toContain("realHeights.size > 0 && !realHeights.has(preciseQuality)");
    // When the engine reports no ladder at all, the pin is KEPT: the
    // selector chain still resolves through its fallbacks.
    expect(card).toMatch(/preciseQuality === "auto" \|\|[\s\S]{0,120}realHeights\.size > 0/);
  });

  it("keeps a video-quality chip out of audio-only mode", () => {
    // Picking a height while the audio mode chip is active would estimate
    // audio size for a video download.
    expect(card).toContain('if (videoQuality === "audio")');
    expect(card).toContain('setVideoQuality("best")');
  });
});
