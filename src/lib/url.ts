/**
 * URL helpers for the downloader.
 *
 * Links rarely arrive in the paste box in a clean state: users copy them
 * from chat apps, notes or share sheets, so the raw text often carries
 * trailing whitespace, quotes, or whole sentences around the actual URL
 * ("watch this: https://youtu.be/…"). These helpers normalize that input
 * so the analyze/download calls always receive a clean URL.
 */

/** First http(s) URL inside the pasted text (quotes and angle brackets excluded). */
const URL_TOKEN = /https?:\/\/[^\s<>"']+/i;

/** Looks like a bare domain path, e.g. "youtu.be/abc" or "www.example.com/v". */
const DOMAIN_LIKE = /^[\w-]+(\.[\w-]+)+(\/\S*)?$/i;

/**
 * Extract & normalize a video URL from raw pasted text.
 *
 * Handles the real-world ways links get pasted:
 * - trailing whitespace / newlines
 * - surrounded by quotes, brackets or angle brackets
 * - copied together with extra text ("watch this: https://youtu.be/…")
 * - missing scheme ("youtu.be/abc" or "www.youtube.com/watch?v=…")
 * - trailing sentence punctuation ("https://youtu.be/abc.")
 *
 * Returns "" when nothing URL-like is found, so callers can show the
 * existing "link not recognized" error instead of a confusing crash.
 */
export function normalizeVideoUrl(raw: string): string {
  if (!raw) return "";

  let text = raw.replace(/\r\n?/g, " ").trim();

  // Grab the first http(s) URL if the text contains extra words.
  const match = text.match(URL_TOKEN);
  if (match) {
    text = match[0];
  } else {
    // No scheme — strip surrounding quotes/brackets and treat the rest as a
    // bare domain path (only when it actually looks like one).
    text = text
      .replace(/^[\s"'“”‘’([{<]+/, "")
      .replace(/[\s"'””‘’)\]}>,]+$/, "")
      .trim();
    if (!DOMAIN_LIKE.test(text)) return "";
    text = `https://${text}`;
  }

  // Strip trailing sentence punctuation ("https://youtu.be/abc.").
  text = text.replace(/[.,;:!?]+$/, "");

  // An unmatched trailing ")" is usually chat noise; keep balanced parens.
  const opens = (text.match(/\(/g) ?? []).length;
  const closes = (text.match(/\)/g) ?? []).length;
  if (closes > opens) {
    text = text.replace(/\)+$/, "");
  }

  // YouTube mobile/music hosts behave identically to www for yt-dlp, but
  // normalizing avoids edge cases in format handling.
  text = text.replace(
    /^https?:\/\/(m|music)\.youtube\.com\//i,
    "https://www.youtube.com/",
  );

  // Hard guarantee: only http/https URLs may leave this function. Every
  // branch above either matched an https?:// token or prefixed https://,
  // but this explicit check keeps the invariant true even if the parsing
  // above is edited later (rejects ftp:, javascript:, data:, file:, …).
  if (!/^https?:\/\//i.test(text)) return "";

  return text;
}

/**
 * Split point for pasted link lists: every `https?://` starts a new URL.
 *
 * The lookahead keeps the scheme attached to the chunk that follows it, so
 * `normalizeVideoUrl()` sees a complete URL for each part. This is what makes
 * ADJACENT links work — the case that broke the old whitespace-only regex:
 *
 *   "https://youtu.be/AAA?si=abchttps://youtu.be/BBB?si=def"
 *
 * …arrives with no space at all, because the first link ends with a query
 * parameter and the next one is glued right after it.
 */
const SCHEME_BOUNDARY = /(?=https?:\/\/)/gi;

/**
 * Extract every valid video URL from a block of pasted text.
 *
 * Handles the three ways people actually paste link lists:
 *   1. one per line
 *   2. separated by spaces / commas inside a sentence
 *   3. **glued together with no separator at all** (adjacent URLs)
 *
 * Each part still goes through `normalizeVideoUrl()`, so quotes, trailing
 * punctuation and `m.youtube.com` normalization stay identical to the
 * single-link path. Duplicates are collapsed (pasting the same link twice
 * downloads it once); the caller gets a de-duplicated array in first-seen
 * order.
 */
export function extractVideoUrls(text: string): string[] {
  if (!text) return [];

  const urls: string[] = [];
  const seen = new Set<string>();

  for (const chunk of text.replace(/\r\n?/g, "\n").split(SCHEME_BOUNDARY)) {
    if (!chunk) continue;
    const normalized = normalizeVideoUrl(chunk);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      urls.push(normalized);
    }
  }

  return urls;
}

/**
 * Check if a URL looks like a video URL from a supported site.
 * Used by the clipboard monitor to filter clipboard content.
 */
export function isVideoUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;

  const lower = url.toLowerCase();

  // Supported video platforms
  const patterns = [
    /youtube\.com\//i,
    /youtu\.be\//i,
    /youtube\.com\/shorts\//i,
    /tiktok\.com\//i,
    /instagram\.com\//i,
    /twitter\.com\//i,
    /x\.com\//i,
    /vimeo\.com\//i,
    /dailymotion\.com\//i,
    /facebook\.com\//i,
    /fb\.watch\//i,
    /twitch\.tv\//i,
    /reddit\.com\//i,
    /redd\.it\//i,
    /soundcloud\.com\//i,
    /streamable\.com\//i,
    /v.redd\.it\//i,
  ];

  return patterns.some((p) => p.test(lower));
}
