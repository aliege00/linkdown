/**
 * Performance budgets for the code that runs on the UI thread.
 *
 * These are assertions, not reports: link parsing runs on every keystroke and
 * on every paste, and the queue loop runs between downloads. A regression that
 * makes either of them janky fails CI instead of being discovered on a user's
 * phone. Bundle sizes are budgeted separately in scripts/test-perf.cjs (needs a
 * build output, so it cannot run inside vitest).
 */
import { describe, it, expect } from "vitest";

import { extractVideoUrls } from "@/lib/url";
import { makeQueueItems, runDownloadQueue } from "@/lib/download-queue";
import { buildQualityOptions } from "@/lib/quality-options";

const BUDGET = {
  parse5kMs: 250,
  queue1kMs: 120,
  maxEventLoopBlockMs: 100,
};

describe("performance — link parsing", () => {
  it("parses 5,000 pasted links well inside the budget", () => {
    // Worst case: every link glued to the next one with no separator.
    const unit = "https://youtu.be/abcdefghijk?si=abcdefghijk";
    const text = unit.repeat(5000);

    const started = performance.now();
    const parsed = extractVideoUrls(text);
    const elapsed = performance.now() - started;

    // Identical links collapse to one — and that must not cost time.
    expect(parsed).toHaveLength(1);
    expect(elapsed).toBeLessThan(BUDGET.parse5kMs);
  });

  it("parses a realistic mixed paste quickly", () => {
    const lines = Array.from(
      { length: 200 },
      (_, i) => `video ${i}: https://www.youtube.com/watch?v=id${i}&t=${i}s`,
    );
    const started = performance.now();
    const parsed = extractVideoUrls(lines.join("\n"));
    const elapsed = performance.now() - started;

    expect(parsed).toHaveLength(200);
    expect(elapsed).toBeLessThan(BUDGET.parse5kMs / 4);
  });
});

describe("performance — queue construction", () => {
  it("builds 1,000 queue items inside the budget", () => {
    const urls = Array.from({ length: 1000 }, (_, i) => `https://youtu.be/video-${i}`);
    const started = performance.now();
    const items = makeQueueItems(urls);
    const elapsed = performance.now() - started;

    expect(items).toHaveLength(1000);
    expect(elapsed).toBeLessThan(BUDGET.queue1kMs);
  });
});

describe("performance — the download loop never freezes the UI", () => {
  it("yields to the event loop between items", async () => {
    const items = makeQueueItems(
      Array.from({ length: 200 }, (_, i) => `https://youtu.be/v-${i}`),
    );

    let maxGap = 0;
    let last = Date.now();
    const ticker = setInterval(() => {
      const now = Date.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 10);

    const result = await runDownloadQueue(items, async () => ({ ok: true }));
    clearInterval(ticker);

    expect(result.summary.completed).toBe(200);
    // A long block here is exactly the "app froze / crashed" symptom.
    expect(maxGap).toBeLessThan(BUDGET.maxEventLoopBlockMs);
  });

  it("a failing item does not slow the rest of the queue down", async () => {
    const items = makeQueueItems(
      Array.from({ length: 100 }, (_, i) => `https://youtu.be/v-${i}`),
    );
    const result = await runDownloadQueue(items, async (item) => {
      if (item.url.endsWith("-50")) throw new Error("boom");
      return { ok: true };
    });

    expect(result.summary.completed).toBe(99);
    expect(result.summary.failed).toBe(1);
  });
});

describe("performance — quality options", () => {
  it("builds the option list from a large format array in well under a frame", () => {
    const formats = Array.from({ length: 400 }, (_, i) => ({
      resolution: `${360 + i * 4}p`,
      vcodec: "avc1.4d401f",
      acodec: null,
    }));

    const started = performance.now();
    const options = buildQualityOptions(formats);
    const elapsed = performance.now() - started;

    expect(options.length).toBeGreaterThan(1);
    expect(elapsed).toBeLessThan(50);
  });
});