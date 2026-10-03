// Format mapping/selection for the desktop engine (yt-dlp --dump-single-json).
//
// Split out of main.cjs so the selection rules are unit-testable: the
// "does a format list contain anything usable?" bug (direct .mp4 links showed
// zero formats) is exactly the kind of rule that must not regress silently.

/**
 * Subtitle / storyboard "formats" are never downloadable media — yt-dlp lists
 * them next to real streams and the UI must not offer them.
 */
const NON_MEDIA_EXTS = new Set([
  "mhtml", "vtt", "srt", "ttml", "ttml.vtt", "sbv", "srv1", "srv2", "srv3",
  "json", "lrc", "ass", "html",
]);

function codecOf(codec) {
  return codec && codec !== "none" ? String(codec) : null;
}

/**
 * Decide whether a raw yt-dlp format entry is a real media stream.
 *
 * The subtle case: for a DIRECT media file (a plain https://…/clip.mp4 link)
 * the generic extractor reports `"vcodec": null, "acodec": null` — unknown,
 * not absent. The old rule dropped anything without a codec, so every direct
 * video link analyzed to "no formats" and could not be downloaded. Text-only
 * formats, by contrast, report the explicit string "none" for both codecs, so
 * they are still filtered out correctly.
 */
function isUsableFormat(f) {
  if (!f) return false;
  const ext = String(f.ext || "").toLowerCase();
  if (NON_MEDIA_EXTS.has(ext)) return false;
  if (ext === "mhtml" || ext === "sbv") return false;
  const vcodec = codecOf(f.vcodec);
  const acodec = codecOf(f.acodec);
  if (vcodec || acodec) return true;
  // Direct media file: codecs are unknown but the entry has a media extension.
  return Boolean(ext);
}

/** Normalize a raw yt-dlp format for the renderer. */
function mapFormat(f) {
  let resolution = "unknown";
  if (f.resolution && f.resolution !== "audio only") resolution = f.resolution;
  else if (f.height) resolution = `${f.width || "?"}x${f.height}`;
  else if (f.format_note) resolution = String(f.format_note);

  return {
    format_id: f.format_id || "",
    ext: f.ext || "",
    resolution,
    filesize: f.filesize || f.filesize_approx || null,
    vcodec: codecOf(f.vcodec),
    acodec: codecOf(f.acodec),
    fps: f.fps || null,
    tbr: f.tbr || null,
  };
}

/**
 * Highest-resolution format that actually carries a stream. Direct media
 * files (null codecs) qualify, so a plain .mp4 link resolves to its own
 * format id instead of falling back to the generic "best".
 */
function pickBestFormatId(formats) {
  const usable = (formats || []).filter(isUsableFormat);
  const both = usable.filter((f) => codecOf(f.vcodec) && codecOf(f.acodec));
  const pool = both.length ? both : usable;
  if (!pool.length) return "best";
  return pool.reduce((best, f) => ((f.height || 0) > (best.height || 0) ? f : best)).format_id || "best";
}

module.exports = { NON_MEDIA_EXTS, codecOf, isUsableFormat, mapFormat, pickBestFormatId };