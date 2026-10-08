/**
 * Progress-bar arithmetic shared by every download progress handler.
 *
 * The native worker restarts itself whenever a download stalls: WorkManager
 * re-runs the job, yt-dlp resumes the existing `.part` file, and the first
 * ticks after the restart start over at 0% even though most of the file is
 * already on disk. The UI used to paint that number verbatim, so the bar
 * visibly "dropped to 0" mid-download — the exact report this fixes.
 *
 * The rule: for the SAME playlist item the displayed percent never
 * decreases; it may start over only when the item itself changes (a
 * playlist moving on to the next video) or when the caller explicitly
 * resets it at the start of a new download.
 */

/**
 * Fold an incoming progress tick into what the screen already shows.
 *
 * @param prevPercent percent currently displayed
 * @param incomingPercent percent reported by the engine this tick
 * @param prevItem playlist item currently displayed (0 for single videos)
 * @param incomingItem playlist item of this tick; when the engine does not
 *   report one, the current item is assumed — missing info must never look
 *   like "a different item" and unlock a reset
 * @returns the percent to display, clamped to [0, 100]
 */
export function monotonicPercent(
  prevPercent: number,
  incomingPercent: number,
  prevItem = 0,
  incomingItem?: number,
): number {
  // Item 0 means "not known yet" (single videos are always 0, and a
  // restarted playlist worker reports 0 until it re-reads the item
  // counter) — unknown must never unlock a reset.
  const item = incomingItem && incomingItem > 0 ? incomingItem : prevItem;
  const incoming = Number.isFinite(incomingPercent)
    ? Math.min(100, Math.max(0, incomingPercent))
    : 0;
  if (item !== prevItem) return incoming;
  return Math.min(100, Math.max(prevPercent, incoming));
}
