/**
 * URL helpers for the downloader.
 *
 * Links rarely arrive in the paste box in a clean state: users copy them
 * from chat apps, notes or share sheets, so the raw text often carries
 * trailing whitespace, quotes, or whole sentences around the actual URL
 * ("watch this: https://youtu.be/…"). These helpers normalize that input
 * so the analyze/download calls always receive a clean URL.
 */

/** First http(s) URL inside the pasted text (quotes excluded, parens kept). */
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

  return text;
}
