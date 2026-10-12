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

describe("sanitizeRawError — additional edge cases", () => {
  it("strips stacked extractor + postprocessor tags", () => {
    expect(sanitizeRawError("ERROR: [youtube] [ffmpeg] Merge failed")).toBe(
      "Merge failed"
    );
  });

  it("keeps only the first meaningful line of a multi-line dump", () => {
    const out = sanitizeRawError(
      "ERROR: [generic] first line\nTraceback (most recent call last):\n  File \"x.py\", line 1",
    );
    expect(out).toBe("first line");
    expect(out).not.toContain("Traceback");
  });

  it("drops yt-dlp option deprecation warnings (warning: … deprecated)", () => {
    const out = sanitizeRawError(
      "Warning: The option --force-ipv4 is deprecated\nERROR: [generic] keep me",
    );
    expect(out).toBe("keep me");
  });

  it("leaves a plain message without tags untouched", () => {
    expect(sanitizeRawError("Network is unreachable")).toBe(
      "Network is unreachable"
    );
  });
});

describe("explainError — remaining categories", () => {
  it("classifies a missing engine (browser preview) as no-engine", () => {
    const e = explainError(
      "No download engine available in this preview. Install the Android APK or Windows EXE — no server needed.",
      "en",
    );
    expect(e.category).toBe("no-engine");
    expect(e.steps.join(" ")).toMatch(/APK/i);
  });

  it("classifies a suspiciously small file as corrupt-file", () => {
    const e = explainError(
      "The downloaded file is suspiciously small (812 bytes).",
      "en",
    );
    expect(e.category).toBe("corrupt-file");
  });

  it("classifies a broken stream merge as merge-failed (not ffmpeg)", () => {
    const e = explainError(
      "The download finished but video and audio streams couldn't be merged properly.",
      "en",
    );
    expect(e.category).toBe("merge-failed");
  });

  it("classifies an HTML page saved instead of a video as blocked", () => {
    const e = explainError(
      "The downloaded file is not a video — it looks like a web page or error response.",
      "en",
    );
    expect(e.category).toBe("blocked");
  });

  it("keeps ffmpeg ahead of merge-failed when both words appear", () => {
    expect(
      explainError("ffmpeg postprocessing failed while merging", "en").category,
    ).toBe("ffmpeg");
  });

  it("keeps bot-check ahead of network for HTTP 403", () => {
    expect(
      explainError("HTTP Error 403: Forbidden", "en").category,
    ).toBe("bot-check");
  });

  it("exposes the sanitized raw error as `technical`", () => {
    const raw = "ERROR: [youtube] dQw4: Video unavailable\nTraceback…";
    const e = explainError(raw, "tr");
    expect(e.technical).toBe(sanitizeRawError(raw));
    expect(e.technical).toBe("Video unavailable");
  });
});

describe("explainError — every category ships usable copy", () => {
  // One raw message per ErrorCategory; if a category's copy is ever
  // removed (or a matcher drifts and stops firing), this fails loudly.
  const MATRIX: Array<[string, string]> = [
    ["No download engine available in this preview", "no-engine"],
    ["Sign in to confirm you're not a bot", "bot-check"],
    ["Unsupported URL: https://x.example", "invalid-url"],
    ["This video is not available in your country", "geo"],
    ["This video is private", "private"],
    ["age-restricted content", "age"],
    ["getaddrinfo failed", "network"],
    ["members-only content", "paid"],
    ["login required to view", "login"],
    ["ffmpeg postprocessing error", "ffmpeg"],
    [
      "the download finished but video and audio streams couldn't be merged properly",
      "merge-failed",
    ],
    ["the downloaded file is suspiciously small (812 bytes)", "corrupt-file"],
    [
      "the downloaded file is not a video — it looks like a web page or error response",
      "blocked",
    ],
    ["no entries in playlist", "playlist"],
    ["kaboom xyzzy", "generic"],
  ];

  it("covers all 15 categories", () => {
    expect(MATRIX.map(([, cat]) => cat).sort()).toEqual(
      [
        "age",
        "blocked",
        "bot-check",
        "corrupt-file",
        "ffmpeg",
        "generic",
        "geo",
        "invalid-url",
        "login",
        "merge-failed",
        "network",
        "no-engine",
        "paid",
        "playlist",
        "private",
      ].sort(),
    );
  });

  for (const [raw, category] of MATRIX) {
    for (const lang of ["tr", "en"] as const) {
      it(`${category} → non-empty ${lang} copy with steps`, () => {
        const e = explainError(raw, lang);
        expect(e.category).toBe(category);
        expect(e.title.length).toBeGreaterThan(0);
        expect(e.message.length).toBeGreaterThan(0);
        expect(e.steps.length).toBeGreaterThan(0);
        expect(e.steps.every((s) => s.trim().length > 0)).toBe(true);
      });
    }
  }

  it("Turkish and English copy are actually different languages", () => {
    const tr = explainError("getaddrinfo failed", "tr");
    const en = explainError("getaddrinfo failed", "en");
    expect(tr.title).toBe("İnternet bağlantısı sorunu");
    expect(en.title).toBe("Internet connection problem");
    expect(tr.title).not.toBe(en.title);
  });
});
