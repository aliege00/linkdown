import { describe, it, expect } from "vitest";
import { formatDuration, formatSize } from "@/lib/ytdlp";

describe("formatDuration", () => {
  it("returns placeholder for null", () => {
    expect(formatDuration(null)).toBe("--:--");
  });

  it("returns placeholder for 0", () => {
    expect(formatDuration(0)).toBe("--:--");
  });

  it("formats seconds only", () => {
    expect(formatDuration(59)).toBe("0:59");
  });

  it("pads seconds and minutes", () => {
    expect(formatDuration(61)).toBe("1:01");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("formats hours", () => {
    expect(formatDuration(3661)).toBe("1:01:01");
    expect(formatDuration(7200)).toBe("2:00:00");
  });
});

describe("formatSize", () => {
  it("returns Unknown for null", () => {
    expect(formatSize(null)).toBe("Unknown");
  });

  it("returns Unknown for 0 (unknown size)", () => {
    expect(formatSize(0)).toBe("Unknown");
  });

  it("formats bytes", () => {
    expect(formatSize(512)).toBe("512 B");
  });

  it("formats kilobytes", () => {
    expect(formatSize(2048)).toBe("2.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("formats gigabytes with two decimals", () => {
    expect(formatSize(1.5 * 1024 * 1024 * 1024)).toBe("1.50 GB");
  });
});
