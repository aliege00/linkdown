/**
 * Progress-bar regression tests.
 *
 * Shipped bug: "the bar suddenly drops to 0 mid-download". The worker
 * restarts itself after a stall (WorkManager retry), resumes the `.part`
 * file it already has and re-reports percentages from 0 — the UI painted
 * that number verbatim, so the bar visibly yanked back to the start while
 * the file was actually 60% done.
 *
 * `monotonicPercent` is the rule that prevents the drop. These tests pin
 * both the arithmetic (executed here) and the fact that every progress
 * handler in the card actually goes through it (source assertions — there
 * is no DOM in this suite).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { monotonicPercent } from "@/lib/progress";

const card = readFileSync(
  resolve(__dirname, "../components/DownloaderCard.tsx"),
  "utf-8",
);

describe("monotonicPercent", () => {
  it("never drops for the same playlist item", () => {
    expect(monotonicPercent(60, 61)).toBe(61);
    expect(monotonicPercent(60, 60)).toBe(60);
    // The stall-restart case: the worker re-reports from 0 while the
    // resumed .part file is still 60% complete.
    expect(monotonicPercent(60, 0)).toBe(60);
    expect(monotonicPercent(60, 12)).toBe(60);
    expect(monotonicPercent(60, 95)).toBe(95);
  });

  it("clamps into [0, 100] no matter what the engine sends", () => {
    expect(monotonicPercent(10, 150)).toBe(100);
    expect(monotonicPercent(10, -5)).toBe(10);
    expect(monotonicPercent(10, Number.NaN)).toBe(10);
  });

  it("starts over only when the playlist moves to the next item", () => {
    expect(monotonicPercent(99, 3, 1, 2)).toBe(3);
    expect(monotonicPercent(50, 80, 2, 2)).toBe(80);
    expect(monotonicPercent(0, 45, 4, 5)).toBe(45);
  });

  it("treats a missing or zero item as 'same job'", () => {
    // A restarted playlist worker reports item 0 until it re-reads the
    // counter — that must never unlock a reset.
    expect(monotonicPercent(70, 5, 3, 0)).toBe(70);
    expect(monotonicPercent(70, 5, 3, undefined)).toBe(70);
    // Single videos are always item 0/undefined: plain monotonic.
    expect(monotonicPercent(40, 0)).toBe(40);
    expect(monotonicPercent(40, Number.NaN)).toBe(40);
  });
});

describe("DownloaderCard progress wiring", () => {
  it("routes all four progress handlers through monotonicPercent", () => {
    // Single download, playlist, playlist entry and the adopted (reattach)
    // job each paint the bar once.
    const uses = (card.match(/monotonicPercent\(/g) ?? []).length;
    expect(uses, "every progress handler must clamp").toBeGreaterThanOrEqual(4);
    // Item-aware variants: playlist (prev.item) and entry (always item 1).
    expect(card).toContain("prev.item ?? 0,\n              progress.item,");
    expect(card).toContain("monotonicPercent(prev.percent, progress.percent, 1, 1)");
  });

  it("never paints an incoming percent verbatim", () => {
    // Any raw `percent: progress.percent` in a state update reopens the
    // drop-to-zero bug the moment the worker restarts.
    expect(card).not.toContain("percent: progress.percent,");
  });

  it("still resets the bar explicitly when a new download starts", () => {
    // Monotonic must not freeze the bar at the previous job's value.
    expect(card).toContain('setDownloadProgress({ percent: 0, speed: "0", eta: "--:--" });');
  });

  it("signals completion from the raw tick, not the clamped one", () => {
    // The clamp can hold at 60 while the engine actually finished; the
    // complete transition must key off the incoming 100.
    expect(card).toContain('if (progress.percent >= 100) updateState("complete");');
  });
});
