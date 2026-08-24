import { describe, it, expect } from "vitest";
import { normalizeVideoUrl } from "@/lib/url";

describe("normalizeVideoUrl", () => {
  // ── Basic URLs ──
  it("returns clean YouTube URL as-is", () => {
    expect(normalizeVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
  });

  it("returns clean TikTok URL as-is", () => {
    expect(normalizeVideoUrl("https://www.tiktok.com/@user/video/123456")).toBe(
      "https://www.tiktok.com/@user/video/123456"
    );
  });

  // ── Trailing whitespace / newlines ──
  it("strips trailing whitespace", () => {
    expect(normalizeVideoUrl("https://youtu.be/abc   ")).toBe("https://youtu.be/abc");
  });

  it("strips trailing newlines", () => {
    expect(normalizeVideoUrl("https://youtu.be/abc\n")).toBe("https://youtu.be/abc");
  });

  it("strips trailing \\r\\n", () => {
    expect(normalizeVideoUrl("https://youtu.be/abc\r\n")).toBe("https://youtu.be/abc");
  });

  // ── Extra text around URL ──
  it("extracts URL from surrounding text", () => {
    expect(
      normalizeVideoUrl("watch this: https://youtu.be/abc for more")
    ).toBe("https://youtu.be/abc");
  });

  it("extracts URL from quoted text", () => {
    expect(normalizeVideoUrl('"https://youtu.be/abc"')).toBe("https://youtu.be/abc");
  });

  // ── Trailing punctuation ──
  it("strips trailing period", () => {
    expect(normalizeVideoUrl("https://youtu.be/abc.")).toBe("https://youtu.be/abc");
  });

  it("strips trailing exclamation", () => {
    expect(normalizeVideoUrl("https://youtu.be/abc!")).toBe("https://youtu.be/abc");
  });

  it("strips trailing question mark", () => {
    expect(normalizeVideoUrl("https://youtu.be/abc?")).toBe("https://youtu.be/abc");
  });

  // ── Unbalanced parentheses ──
  it("strips unmatched trailing paren", () => {
    expect(normalizeVideoUrl("https://youtu.be/abc)")).toBe("https://youtu.be/abc");
  });

  it("keeps balanced parentheses", () => {
    expect(normalizeVideoUrl("https://en.wikipedia.org/wiki/Foo_(bar)")).toBe(
      "https://en.wikipedia.org/wiki/Foo_(bar)"
    );
  });

  // ── YouTube normalization ──
  it("normalizes m.youtube.com to www.youtube.com", () => {
    expect(normalizeVideoUrl("https://m.youtube.com/watch?v=abc")).toBe(
      "https://www.youtube.com/watch?v=abc"
    );
  });

  it("normalizes music.youtube.com to www.youtube.com", () => {
    expect(normalizeVideoUrl("https://music.youtube.com/watch?v=abc")).toBe(
      "https://www.youtube.com/watch?v=abc"
    );
  });

  // ── Missing scheme ──
  it("adds https:// to bare domain", () => {
    expect(normalizeVideoUrl("youtu.be/abc")).toBe("https://youtu.be/abc");
  });

  it("adds https:// to www domain", () => {
    expect(normalizeVideoUrl("www.youtube.com/watch?v=abc")).toBe(
      "https://www.youtube.com/watch?v=abc"
    );
  });

  // ── Edge cases ──
  it("returns empty string for empty input", () => {
    expect(normalizeVideoUrl("")).toBe("");
  });

  it("returns empty string for non-URL text", () => {
    expect(normalizeVideoUrl("hello world")).toBe("");
  });

  it("returns empty string for random words", () => {
    expect(normalizeVideoUrl("download this video")).toBe("");
  });

  // ── Angle brackets ──
  it("strips closing angle bracket from URL", () => {
    // Input: <https://youtu.be/abc> — the regex stops before >
    expect(normalizeVideoUrl("<https://youtu.be/abc>")).toBe("https://youtu.be/abc");
  });

  it("handles URL with angle brackets in surrounding text", () => {
    expect(normalizeVideoUrl("visit <https://youtu.be/abc> for more")).toBe(
      "https://youtu.be/abc"
    );
  });

  // ── Complex real-world inputs ──
  it("handles URL with query params and trailing text", () => {
    expect(
      normalizeVideoUrl("https://www.youtube.com/watch?v=abc&list=PLxyz check this")
    ).toBe("https://www.youtube.com/watch?v=abc&list=PLxyz");
  });

  it("handles WhatsApp-style forwarded message", () => {
    expect(
      normalizeVideoUrl(
        "转发的消息\nhttps://www.tiktok.com/@nba/video/7441322573611494702\n"
      )
    ).toBe("https://www.tiktok.com/@nba/video/7441322573611494702");
  });
});
