import { describe, it, expect } from "vitest";
import { explainError, sanitizeRawError } from "@/lib/error-help";

describe("sanitizeRawError", () => {
  it("strips ERROR: [extractor] prefixes", () => {
    expect(sanitizeRawError("ERROR: [youtube] dQw4w9WgXcQ: Video unavailable")).toBe(
      "Video unavailable"
    );
  });

  it("drops deprecated-feature noise lines", () => {
    const out = sanitizeRawError(
      "Deprecated Feature: --some-flag\nERROR: [generic] boom"
    );
    expect(out).toBe("boom");
  });

  it("drops [debug] lines", () => {
    const out = sanitizeRawError("[debug] shimmy\nERROR: [generic] real error");
    expect(out).toBe("real error");
  });

  it("drops trailing yt-dlp GitHub links", () => {
    const out = sanitizeRawError(
      "ERROR: Sign in to confirm you're not a bot. See https://github.com/yt-dlp/yt-dlp#faq for more info"
    );
    expect(out).not.toContain("github.com");
    expect(out).toContain("Sign in to confirm");
  });

  it("truncates very long errors to 400 chars + ellipsis", () => {
    const long = "x".repeat(1000);
    const out = sanitizeRawError(long);
    expect(out.length).toBe(401); // 400 chars + …
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeRawError("")).toBe("");
  });
});

describe("explainError — scenario matrix", () => {
  // ── Network layer ──
  it("classifies socket timeouts as network", () => {
    const e = explainError("timed out after 30 seconds", "en");
    expect(e.category).toBe("network");
  });

  it("classifies DNS/connection failures as network", () => {
    expect(explainError("getaddrinfo failed", "en").category).toBe("network");
    expect(explainError("Connection refused by server", "en").category).toBe(
      "network"
    );
  });

  it("classifies SSL/certificate problems as network", () => {
    expect(explainError("SSL handshake failure", "en").category).toBe("network");
  });

  // ── Bot checks (HTTP 403/429 rate limiting) ──
  it("classifies YouTube bot-check as bot-check", () => {
    const e = explainError(
      "Sign in to confirm you're not a bot",
      "en"
    );
    expect(e.category).toBe("bot-check");
    expect(e.steps[0]).toMatch(/VPN/i);
  });

  it("classifies HTTP 403 as bot-check", () => {
    expect(explainError("HTTP Error 403: Forbidden", "en").category).toBe(
      "bot-check"
    );
  });

  it("classifies HTTP 429 / rate limit as bot-check", () => {
    expect(explainError("HTTP Error 429: Too Many Requests", "en").category).toBe(
      "bot-check"
    );
    expect(explainError("rate limit reached", "tr").category).toBe("bot-check");
  });

  // ── URL parsing ──
  it("classifies unsupported URL as invalid-url", () => {
    expect(explainError("Unsupported URL: https://x.example", "en").category).toBe(
      "invalid-url"
    );
  });

  // ── Geo must win over private (matcher order) ──
  it("classifies geo-restriction before the broader 'unavailable' match", () => {
    const e = explainError(
      "This video is not available in your country",
      "en"
    );
    expect(e.category).toBe("geo");
  });

  it("classifies removed/private videos", () => {
    expect(explainError("Video unavailable", "en").category).toBe("private");
    expect(explainError("This video has been removed", "en").category).toBe(
      "private"
    );
  });

  // ── Access control ──
  it("classifies age restriction", () => {
    expect(explainError("age-restricted content", "en").category).toBe("age");
  });

  it("classifies login requirement", () => {
    expect(explainError("login required to view", "en").category).toBe("login");
  });

  it("classifies paid/members-only content", () => {
    expect(explainError("members-only content", "en").category).toBe("paid");
  });

  // ── Media processing ──
  it("classifies ffmpeg merge failures", () => {
    expect(explainError("ffmpeg reported an error while merging", "en").category).toBe(
      "ffmpeg"
    );
  });

  it("classifies playlist processing failures", () => {
    expect(explainError("no entries in playlist", "en").category).toBe("playlist");
  });

  // ── Fallback ──
  it("falls back to generic for unknown errors", () => {
    expect(explainError("kaboom xyzzy", "en").category).toBe("generic");
  });

  // ── Localization ──
  it("returns Turkish copy when lang=tr", () => {
    const e = explainError("Sign in to confirm you're not a bot", "tr");
    expect(e.title).toBe("YouTube bot kontrolüne takıldı");
  });

  it("returns English copy when lang=en", () => {
    const e = explainError("Sign in to confirm you're not a bot", "en");
    expect(e.title).toBe("YouTube bot check");
  });
});
