/**
 * Client-side download history.
 *
 * Records what the user downloaded (title, URL, kind) in localStorage so the
 * app can show a small "recent downloads" list everywhere — including plain
 * browser builds where there is no filesystem list to read. Never stores any
 * file contents, just metadata.
 */

export interface DownloadRecord {
  /** Unique id (timestamp-based). */
  id: string;
  /** Video title, or playlist title when kind === "playlist". */
  title: string;
  /** The video / playlist URL. */
  url: string;
  kind: "video" | "playlist";
  /** Number of videos saved (playlist downloads). */
  count?: number;
  /** Format label the user picked (single videos). */
  formatLabel?: string;
  /** Unix ms timestamp of when the download finished. */
  time: number;
}

const STORAGE_KEY = "vidfetch.downloadHistory";
const MAX_ENTRIES = 50;

function safeParse(raw: string | null): DownloadRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is DownloadRecord =>
        !!r && typeof r.title === "string" && typeof r.time === "number",
    );
  } catch {
    return [];
  }
}

/** All recorded downloads, newest first. */
export function getDownloadHistory(): DownloadRecord[] {
  try {
    return safeParse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Prepend a finished download to the history (newest first, capped). */
export function addDownloadRecord(record: Omit<DownloadRecord, "id">): DownloadRecord[] {
  const entry: DownloadRecord = {
    ...record,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  const next = [entry, ...getDownloadHistory()].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full / unavailable — history is best-effort only.
  }
  return next;
}

/** Remove every recorded download. */
export function clearDownloadHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore — best-effort.
  }
}
