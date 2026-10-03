import { describe, it, expect, vi, afterEach } from "vitest";

import { extractVideoUrls, normalizeVideoUrl } from "@/lib/url";
import {
  makeQueueItems,
  runDownloadQueue,
  summarize,
  type QueueItem,
} from "@/lib/download-queue";
import { buildQualityOptions, defaultQualityOption, heightOf } from "@/lib/quality-options";

// ── 1. Input parsing ──────────────────────────────────────────────────

describe("extractVideoUrls — adjacent links (the reported bug)", () => {
  it("splits two YouTube links glued together with no separator", () => {
    const pasted =
      "https://youtu.be/R33bq-51XWo?si=otokurat8EPhdJFMhttps://youtu.be/R33bq-51XWo?si=otokurat8EPhdJFM";
    const urls = extractVideoUrls(pasted);
    // Same link twice → de-duplicated to one download.
    expect(urls).toEqual(["https://youtu.be/R33bq-51XWo?si=otokurat8EPhdJFM"]);
  });

  it("splits two DIFFERENT links glued together", () => {
    const pasted =
      "https://youtu.be/R33bq-51XWo?si=aaahttps://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s";
    expect(extractVideoUrls(pasted)).toEqual([
      "https://youtu.be/R33bq-51XWo?si=aaa",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s",
    ]);
  });

  it("handles three links with mixed separators", () => {
    const pasted =
      "https://youtu.be/aaa\nhttps://vimeo.com/12345, https://twitch.tv/videos/99999";
    expect(extractVideoUrls(pasted)).toEqual([
      "https://youtu.be/aaa",
      "https://vimeo.com/12345",
      "https://twitch.tv/videos/99999",
    ]);
  });

  it("keeps the surrounding prose out of the URLs", () => {
    const pasted = 'watch this https://youtu.be/abc then "https://vimeo.com/77"';
    expect(extractVideoUrls(pasted)).toEqual([
      "https://youtu.be/abc",
      "https://vimeo.com/77",
    ]);
  });

  it("returns an empty array for text without links", () => {
    expect(extractVideoUrls("no links here")).toEqual([]);
    expect(extractVideoUrls("")).toEqual([]);
  });

  it("normalizes mobile hosts inside a list exactly like the single-link path", () => {
    expect(extractVideoUrls("https://m.youtube.com/watch?v=abc")).toEqual([
      "https://www.youtube.com/watch?v=abc",
    ]);
    expect(normalizeVideoUrl("https://m.youtube.com/watch?v=abc")).toBe(
      "https://www.youtube.com/watch?v=abc",
    );
  });

  it("strips trailing punctuation between adjacent links", () => {
    expect(extractVideoUrls("https://youtu.be/aaa.https://youtu.be/bbb")).toEqual([
      "https://youtu.be/aaa",
      "https://youtu.be/bbb",
    ]);
  });
});

// ── 2. Queue behaviour ────────────────────────────────────────────────

const urls = ["https://youtu.be/a", "https://youtu.be/b", "https://youtu.be/c"];

function items(list = urls): QueueItem[] {
  return makeQueueItems(list);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makeQueueItems", () => {
  it("creates one pending item per URL", () => {
    const list = items();
    expect(list).toHaveLength(3);
    expect(list.every((i) => i.status === "pending" && i.percent === 0)).toBe(true);
  });

  it("ignores blanks and duplicates", () => {
    expect(makeQueueItems(["https://a.com/x", "", "https://a.com/x", "  "])).toHaveLength(1);
  });

  it("keeps already-tracked URLs stable when re-parsing", () => {
    const first = items();
    const second = makeQueueItems(urls, first);
    expect(second.map((i) => i.id)).toEqual(first.map((i) => i.id));
    expect(second).toHaveLength(3);
  });
});

describe("runDownloadQueue — strictly sequential", () => {
  it("never runs two workers at the same time", async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];

    await runDownloadQueue(items(), async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(item.url);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return { ok: true, fileName: `f-${item.id}` };
    });

    expect(maxActive).toBe(1);
    expect(order).toEqual(urls);
  });

  it("marks every successful item completed with its file name", async () => {
    const result = await runDownloadQueue(items(), async (item) => ({
      ok: true,
      fileName: `${item.url}.mp4`,
    }));

    expect(result.summary).toEqual({
      total: 3,
      completed: 3,
      failed: 0,
      cancelled: 0,
      pending: 0,
    });
    expect(result.items.every((i) => i.status === "completed" && i.percent === 100)).toBe(true);
    expect(result.items[1].fileName).toContain("youtu.be/b");
  });

  it("a failing link does not stop the rest of the queue", async () => {
    const result = await runDownloadQueue(items(), async (item) => {
      if (item.url === urls[1]) throw new Error("engine exploded");
      return { ok: true };
    });

    expect(result.summary).toEqual({
      total: 3,
      completed: 2,
      failed: 1,
      cancelled: 0,
      pending: 0,
    });
    expect(result.items[1].error).toContain("engine exploded");
    expect(result.items[2].status).toBe("completed");
  });

  it("treats a rejected download (ok:false) as a failure, not a crash", async () => {
    const result = await runDownloadQueue(items(), async (item) =>
      item.url === urls[0] ? { ok: false, error: "Video unavailable" } : { ok: true },
    );

    expect(result.summary.failed).toBe(1);
    expect(result.items[0].error).toBe("Video unavailable");
  });

  it("never rejects, even when every item throws", async () => {
    const result = await runDownloadQueue(items(), async () => {
      throw new Error("nope");
    });
    expect(result.summary.failed).toBe(3);
    expect(result.items.every((i) => i.status === "failed")).toBe(true);
  });

  it("stops starting new items after abort and marks the rest cancelled", async () => {
    const signal = { aborted: false };
    const started: string[] = [];

    const result = await runDownloadQueue(
      items(),
      async (item) => {
        started.push(item.url);
        return { ok: true };
      },
      {
        signal,
        // The user presses "Stop" right after the first link finished.
        onItemSettled: (item, index) => {
          if (index === 0) signal.aborted = true;
        },
      },
    );

    expect(started).toEqual([urls[0]]);
    expect(result.summary.cancelled).toBe(2);
    expect(result.summary.completed).toBe(1);
  });

  it("an abort that lands mid-download still cancels that item", async () => {
    const signal = { aborted: false };
    const result = await runDownloadQueue(
      items(),
      async () => {
        signal.aborted = true;
        return { ok: true };
      },
      { signal },
    );
    expect(result.items[0].status).toBe("cancelled");
    expect(result.summary.completed).toBe(0);
  });

  it("skips items already completed by a previous run", async () => {
    const first = await runDownloadQueue(items(), async () => ({ ok: true }));
    let calls = 0;
    const second = await runDownloadQueue(first.items, async () => {
      calls += 1;
      return { ok: true };
    });
    expect(calls).toBe(0);
    expect(second.summary.completed).toBe(3);
  });

  it("reports progress for the active item and a full snapshot on every change", async () => {
    const progress: number[] = [];
    const snapshots: number[] = [];

    await runDownloadQueue(
      items(),
      async () => ({ ok: true }),
      {
        onItemStart: (item) => progress.push(item.status === "downloading" ? 1 : 0),
        onChange: (items) => snapshots.push(items.length),
        yieldBetweenItems: false,
      },
    );

    expect(progress).toEqual([1, 1, 1]);
    expect(snapshots.length).toBeGreaterThanOrEqual(4);
    expect(snapshots[snapshots.length - 1]).toBe(3);
  });
});

describe("summarize", () => {
  it("counts every status", () => {
    const list: QueueItem[] = [
      { id: "1", url: "a", status: "completed", percent: 100 },
      { id: "2", url: "b", status: "failed", percent: 0 },
      { id: "3", url: "c", status: "pending", percent: 0 },
      { id: "4", url: "d", status: "cancelled", percent: 0 },
    ];
    expect(summarize(list)).toEqual({
      total: 4,
      completed: 1,
      failed: 1,
      cancelled: 1,
      pending: 1,
    });
  });
});

// ── 3. Quality options must reflect the REAL formats ──────────────────

describe("buildQualityOptions", () => {
  const formats = [
    { resolution: "1920x1080", vcodec: "avc1.640028", acodec: null },
    { resolution: "1920x1080", vcodec: "avc1.640028", acodec: null },
    { resolution: "1280x720", vcodec: "avc1.4d401f", acodec: null },
    { resolution: "854x480", vcodec: "avc1.42001f", acodec: null },
  ];

  it("only offers heights the video really has", () => {
    const labels = buildQualityOptions(formats).map((o) => o.label);
    expect(labels).toContain("1080p");
    expect(labels).toContain("720p");
    expect(labels).toContain("480p");
    // No 1440p / 2160p stream exists → must NOT be offered.
    expect(labels).not.toContain("1440p");
    expect(labels).not.toContain("2160p");
  });

  it("never offers a 360p chip for a video that has none", () => {
    expect(buildQualityOptions(formats).map((o) => o.label)).not.toContain("360p");
  });

  it("always offers an uncapped Best entry first", () => {
    const options = buildQualityOptions(formats);
    expect(options[0].height).toBeNull();
    expect(options[0].label).toBe("Best");
  });

  it("reports how many real streams back each height", () => {
    const options = buildQualityOptions(formats);
    expect(options.find((o) => o.height === 1080)?.streamCount).toBe(2);
    expect(options.find((o) => o.height === 720)?.streamCount).toBe(1);
  });

  it("gives every video option a distinct, non-empty selector", () => {
    const selectors = buildQualityOptions(formats).map((o) => o.selector);
    expect(new Set(selectors).size).toBe(selectors.length);
    expect(selectors.every((s) => s.length > 0)).toBe(true);
  });

  it("falls back to Best + Audio when the engine reports nothing usable", () => {
    const options = buildQualityOptions([]);
    expect(options.map((o) => o.label)).toEqual(["Best", "Audio"]);
  });

  it("adds an audio entry for an audio-only source", () => {
    const options = buildQualityOptions([
      { resolution: "audio only", vcodec: null, acodec: "mp4a.40.2" },
    ]);
    expect(options.some((o) => o.selector.includes("bestaudio"))).toBe(true);
  });

  it("preselects the tallest real quality, not a guess", () => {
    expect(defaultQualityOption(buildQualityOptions(formats)).label).toBe("1080p");
    expect(defaultQualityOption(buildQualityOptions([])).label).toBe("Best");
  });
});

describe("heightOf", () => {
  it("reads a height from resolution strings and fields", () => {
    expect(heightOf({ resolution: "1920x1080" })).toBe(1080);
    expect(heightOf({ resolution: "1080p" })).toBe(1080);
    expect(heightOf({ height: 720, resolution: "" })).toBe(720);
    expect(heightOf({ resolution: "audio only" })).toBeNull();
    expect(heightOf({})).toBeNull();
  });
});