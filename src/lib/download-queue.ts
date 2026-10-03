/**
 * Sequential download queue.
 *
 * WHY THIS EXISTS (the crash): the download engine is a native yt-dlp process
 * that grabs a foreground-service notification, spawns ffmpeg for merges and
 * writes to MediaStore. Firing several of those at once makes the engine
 * fight itself: two yt-dlp processes writing to the same output template, two
 * foreground services, WorkManager replacing the running job — and on a
 * mid-range phone that ends as an ANR / process death. The app now runs
 * downloads strictly ONE AT A TIME.
 *
 * The rules enforced here:
 *   • sequential — the next item starts only after the previous one settles
 *   • one failing link never stops the queue (try/catch per item)
 *   • the runner never rejects; it always resolves with a summary
 *   • control returns to the event loop between items so React can paint
 *
 * This module is intentionally free of React and of any native import, so the
 * exact code that drives the app can also be executed headlessly in tests.
 */

export type QueueStatus =
  | "pending"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled";

export interface QueueItem {
  /** Stable id, used as the React key and for cancel bookkeeping. */
  id: string;
  url: string;
  /** Title shown in the list once known (from the analyze step). */
  title?: string;
  status: QueueStatus;
  /** 0–100, driven by the engine's progress events. */
  percent: number;
  /** Speed / ETA as reported by the engine, for the active row. */
  speed?: string;
  eta?: string;
  /** Real file name the engine saved (filled on success). */
  fileName?: string;
  /** Error text when status === "failed". */
  error?: string;
}

export interface QueueSummary {
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  pending: number;
}

/** What the queue expects back from the actual download implementation. */
export interface QueueItemResult {
  ok: boolean;
  fileName?: string;
  error?: string;
}

export interface QueueHooks {
  /** Fired right before an item starts (drives the "now downloading" row). */
  onItemStart?: (item: QueueItem, index: number) => void;
  /** Progress tick for the running item. */
  onProgress?: (item: QueueItem, index: number) => void;
  /** Fired after every item settles, whatever the outcome. */
  onItemSettled?: (item: QueueItem, index: number) => void;
  /** Full snapshot after every state change — the queue's source of truth. */
  onChange?: (items: QueueItem[], summary: QueueSummary) => void;
}

export interface RunQueueOptions extends QueueHooks {
  /**
   * Abort signal. Set it from the "Cancel" button: the running item is
   * cancelled and every remaining item is marked cancelled, so the engine
   * never starts work the user no longer wants.
   */
  signal?: { aborted: boolean };
  /** Yield to the event loop between items (default true). */
  yieldBetweenItems?: boolean;
}

export interface QueueRunResult {
  items: QueueItem[];
  summary: QueueSummary;
}

export function summarize(items: QueueItem[]): QueueSummary {
  return {
    total: items.length,
    completed: items.filter((i) => i.status === "completed").length,
    failed: items.filter((i) => i.status === "failed").length,
    cancelled: items.filter((i) => i.status === "cancelled").length,
    pending: items.filter((i) => i.status === "pending").length,
  };
}

/**
 * Hand control back to the browser so React can render between downloads.
 * Without this a long queue would paint only at the very end, and on slow
 * phones the frozen list looks exactly like the crash users reported.
 */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Run every item sequentially.
 *
 * `worker` is awaited to completion for each item before the next one starts —
 * there is no `Promise.all` anywhere in this file by design.
 */
export async function runDownloadQueue(
  items: QueueItem[],
  worker: (item: QueueItem, index: number) => Promise<QueueItemResult>,
  options: RunQueueOptions = {},
): Promise<QueueRunResult> {
  const { signal, yieldBetweenItems = true } = options;
  const snapshot = items.map((item) => ({ ...item }));

  const publish = () => options.onChange?.(snapshot.map((i) => ({ ...i })), summarize(snapshot));

  publish();

  for (let index = 0; index < snapshot.length; index++) {
    if (signal?.aborted) {
      snapshot[index] = { ...snapshot[index], status: "cancelled" };
      options.onItemSettled?.(snapshot[index], index);
      continue;
    }
    if (snapshot[index].status === "completed") continue; // already done in a previous run

    const started: QueueItem = { ...snapshot[index], status: "downloading", percent: 0 };
    snapshot[index] = started;
    options.onItemStart?.(started, index);
    publish();

    try {
      const result = await worker(started, index);

      // A cancel that lands mid-download still wins over a late success.
      if (signal?.aborted) {
        snapshot[index] = { ...started, status: "cancelled", percent: started.percent };
      } else if (result?.ok) {
        snapshot[index] = {
          ...started,
          status: "completed",
          percent: 100,
          fileName: result.fileName,
          error: undefined,
        };
      } else {
        snapshot[index] = {
          ...started,
          status: "failed",
          percent: 0,
          error: result?.error || "Download failed",
        };
      }
    } catch (error) {
      // NEVER let one link take the app down: log, mark the row, keep going.
      const message =
        error instanceof Error ? error.message : typeof error === "string" ? error : "Download failed";
      console.error(`[download-queue] "${started.url}" failed:`, error);
      snapshot[index] = { ...started, status: "failed", percent: 0, error: message };
    }

    options.onItemSettled?.(snapshot[index], index);
    publish();

    if (yieldBetweenItems) await yieldToUi();
  }

  const itemsOut = snapshot.map((i) => ({ ...i }));
  const summary = summarize(itemsOut);
  return { items: itemsOut, summary };
}

/** Build queue items from plain URLs, skipping blanks and duplicates. */
export function makeQueueItems(
  urls: string[],
  existing: QueueItem[] = [],
): QueueItem[] {
  const seen = new Set(existing.map((i) => i.url));
  const out = [...existing.map((i) => ({ ...i }))];
  let seq = 0;

  for (const url of urls) {
    const clean = url.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    seq += 1;
    out.push({
      id: `q-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 7)}`,
      url: clean,
      status: "pending",
      percent: 0,
    });
  }

  return out;
}