/**
 * useBatchQueue — Multi-link sequential download queue.
 *
 * When the user pastes multiple URLs (newline or space separated),
 * this hook:
 *   1. Detects all valid URLs from the input text
 *   2. Adds them to a download queue
 *   3. Downloads them one-by-one (sequential)
 *   4. Tracks progress for each item and overall
 *   5. Shows completed/failed counts
 */

import { useCallback, useRef, useState } from "react";
import { normalizeVideoUrl } from "@/lib/url";

// ── Types ─────────────────────────────────────────────────────────────

export interface QueueItem {
  id: string;
  url: string;
  status: "pending" | "downloading" | "completed" | "failed" | "cancelled";
  progress: number;
  error?: string;
  title?: string;
}

export interface BatchQueueState {
  /** All items in the queue (including completed/failed). */
  items: QueueItem[];
  /** Currently downloading item index (-1 if idle). */
  currentIndex: number;
  /** Whether the queue is actively processing. */
  isProcessing: boolean;
  /** Summary counts. */
  counts: {
    total: number;
    pending: number;
    downloading: number;
    completed: number;
    failed: number;
  };
}

// ── URL Detection ─────────────────────────────────────────────────────

/**
 * Extract all valid video URLs from a text block.
 * Handles newline-separated, space-separated, and mixed formats.
 */
export function extractUrls(text: string): string[] {
  if (!text) return [];

  const urlPattern = /https?:\/\/[^\s<>"')\]]+/gi;
  const matches = text.match(urlPattern) ?? [];

  const urls: string[] = [];
  const seen = new Set<string>();

  for (const raw of matches) {
    const cleaned = normalizeVideoUrl(raw);
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      urls.push(cleaned);
    }
  }

  return urls;
}

/**
 * Check if input text contains multiple URLs.
 */
export function hasMultipleUrls(text: string): boolean {
  return extractUrls(text).length > 1;
}

// ── Hook ──────────────────────────────────────────────────────────────

export function useBatchQueue() {
  const [state, setState] = useState<BatchQueueState>({
    items: [],
    currentIndex: -1,
    isProcessing: false,
    counts: { total: 0, pending: 0, downloading: 0, completed: 0, failed: 0 },
  });

  const queueRef = useRef<QueueItem[]>([]);
  const abortRef = useRef(false);

  /**
   * Parse input text and populate the queue with detected URLs.
   */
  const parseInput = useCallback((text: string): number => {
    const urls = extractUrls(text);
    if (urls.length === 0) return 0;

    const newItems: QueueItem[] = urls.map((url) => ({
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url,
      status: "pending" as const,
      progress: 0,
    }));

    queueRef.current = [...queueRef.current, ...newItems];
    updateState();
    return newItems.length;
  }, []);

  /**
   * Start processing the queue. Calls the download function for each item.
   */
  const startProcessing = useCallback(
    async (
      downloadFn: (url: string, onProgress: (pct: number) => void) => Promise<boolean>,
    ) => {
      if (state.isProcessing) return;
      abortRef.current = false;

      setState((prev) => ({ ...prev, isProcessing: true }));

      for (let i = 0; i < queueRef.current.length; i++) {
        if (abortRef.current) break;

        const item = queueRef.current[i];
        if (item.status !== "pending") continue;

        // Mark as downloading
        queueRef.current[i] = { ...item, status: "downloading", progress: 0 };
        setState((prev) => ({ ...prev, currentIndex: i }));
        updateState();

        try {
          const success = await downloadFn(item.url, (pct) => {
            queueRef.current[i] = { ...queueRef.current[i], progress: pct };
            updateState();
          });

          queueRef.current[i] = {
            ...queueRef.current[i],
            status: success ? "completed" : "failed",
            progress: success ? 100 : 0,
            error: success ? undefined : "Download failed",
          };
        } catch (error) {
          queueRef.current[i] = {
            ...queueRef.current[i],
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }

        updateState();
      }

      setState((prev) => ({ ...prev, isProcessing: false, currentIndex: -1 }));
    },
    [state.isProcessing],
  );

  /**
   * Cancel the entire queue.
   */
  const cancelQueue = useCallback(() => {
    abortRef.current = true;
    queueRef.current = queueRef.current.map((item) =>
      item.status === "pending" || item.status === "downloading"
        ? { ...item, status: "cancelled" as const }
        : item,
    );
    setState((prev) => ({ ...prev, isProcessing: false, currentIndex: -1 }));
    updateState();
  }, []);

  /**
   * Clear all items from the queue.
   */
  const clearQueue = useCallback(() => {
    queueRef.current = [];
    setState({
      items: [],
      currentIndex: -1,
      isProcessing: false,
      counts: { total: 0, pending: 0, downloading: 0, completed: 0, failed: 0 },
    });
  }, []);

  /**
   * Get the next pending item (for single-item mode).
   */
  const getNextPending = useCallback((): QueueItem | null => {
    return queueRef.current.find((item) => item.status === "pending") ?? null;
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────

  function updateState() {
    const items = [...queueRef.current];
    const counts = {
      total: items.length,
      pending: items.filter((i) => i.status === "pending").length,
      downloading: items.filter((i) => i.status === "downloading").length,
      completed: items.filter((i) => i.status === "completed").length,
      failed: items.filter((i) => i.status === "failed").length,
    };
    setState((prev) => ({ ...prev, items, counts }));
  }

  return {
    state,
    parseInput,
    startProcessing,
    cancelQueue,
    clearQueue,
    getNextPending,
    extractUrls,
    hasMultipleUrls,
  };
}
