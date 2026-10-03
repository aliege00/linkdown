/**
 * Light/dark theme regression guard.
 *
 * Light mode was broken for a long time and nothing caught it:
 *   1. `:root` held the DARK palette, so the default (no `.dark` class) was
 *      dark and "light" simply did not exist.
 *   2. `body` and `html, body, #root` pinned `background-color:#0d0f12`,
 *      which overrode the tokens entirely — even a correct palette could not
 *      show through.
 *   3. Components hardcoded the dark hexes, so switching themes repainted
 *      almost nothing.
 *
 * These assertions read the actual stylesheet, so the same mistake fails CI
 * instead of shipping.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(__dirname, "../index.css"), "utf-8");

/** Extract the body of the first `:root { … }` / `.dark { … }` block. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block must exist`).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

function token(source: string, name: string): string {
  const match = source.match(new RegExp(`${name}:\\s*([^;]+);`));
  return match ? match[1].trim() : "";
}

/** Relative luminance of a #rgb/#rrggbb color. */
function luminance(hex: string): number {
  const full = hex.length === 4
    ? "#" + hex.slice(1).split("").map((c) => c + c).join("")
    : hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const root = block(":root");
const dark = block(".dark");

describe("light theme (default)", () => {
  it(":root is a LIGHT palette", () => {
    expect(luminance(token(root, "--background"))).toBeGreaterThan(0.6);
    expect(luminance(token(root, "--foreground"))).toBeLessThan(0.4);
  });

  it("the light primary is dark enough to read as text on a light surface", () => {
    // #6cb4ee (the dark theme's blue) is unreadable on white; light mode needs
    // its own, deeper value.
    expect(luminance(token(root, "--primary"))).toBeLessThan(0.5);
  });

  it("declares color-scheme so native widgets follow the theme", () => {
    expect(root).toContain("color-scheme: light");
    expect(dark).toContain("color-scheme: dark");
  });

  it("defines the same tokens as the dark theme (no stale token when switching)", () => {
    // --radius is theme-independent (it lives in :root only).
    const names = (src: string) =>
      [...src.matchAll(/(--[a-z0-9-]+):/g)]
        .map((m) => m[1])
        .filter((n) => n !== "--radius")
        .sort();
    expect(names(root)).toEqual(names(dark));
  });
});

describe("dark theme", () => {
  it("keeps the original dark background", () => {
    expect(token(dark, "--background")).toBe("#0d0f12");
    expect(luminance(token(dark, "--background"))).toBeLessThan(0.1);
  });

  it("is lighter than the light background (the toggle actually changes it)", () => {
    expect(luminance(token(dark, "--background"))).toBeLessThan(
      luminance(token(root, "--background")),
    );
  });
});

describe("theme-driven surfaces", () => {
  it("never pins a literal background color on body / html / #root", () => {
    // Comments are stripped first: this file documents the old hardcoded hex,
    // and the documentation must not read as a live declaration.
    const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    // The hardcoded dark background was the reason light mode looked broken.
    const baseLayer = cssNoComments.slice(
      cssNoComments.indexOf("@layer base"),
      cssNoComments.indexOf("::-webkit-scrollbar"),
    );
    const rootLayer = cssNoComments.slice(
      cssNoComments.indexOf("html,\nbody,\n#root"),
      cssNoComments.indexOf("body {\n  overflow-y"),
    );
    expect(baseLayer).not.toMatch(/background-color:\s*#/);
    expect(rootLayer).not.toMatch(/background-color:\s*#/);
  });

  it("uses the background/foreground tokens instead", () => {
    expect(css).toMatch(/background-color:\s*var\(--background\)/);
    expect(css).toMatch(/color:\s*var\(--foreground\)/);
  });
});

describe("no hardcoded dark surfaces left in components", () => {
  const files = [
    "src/components/BottomTabBar.tsx",
    "src/components/FlatCard.tsx",
    "src/components/DownloaderCard.tsx",
    "src/components/tabs/SettingsTab.tsx",
    "src/components/tabs/HistoryTab.tsx",
    "src/components/HelpCenter.tsx",
    "src/pages/Dashboard.tsx",
    "src/pages/HelpPage.tsx",
  ];

  it.each(files)("%s uses theme tokens, not fixed dark colors", (file) => {
    const source = readFileSync(resolve(__dirname, "..", "..", file), "utf-8");
    // Brand accents that sit ON the blue gradient are allowed; surfaces and
    // body text are not.
    const offenders = source.match(/bg-\[#0d0f12\]|bg-\[#17191e\]|text-\[#e8e8e8\]|text-\[#8e8e93\]|border-\[#262930\]|bg-\[#1e2026\]/g);
    expect(offenders ?? []).toEqual([]);
  });
});

describe("help center lives on its own route", () => {
  it("/help is registered", () => {
    const main = readFileSync(resolve(__dirname, "../main.tsx"), "utf-8");
    expect(main).toContain('path="/help"');
  });

  it("the settings tab links to it instead of embedding the help tabs", () => {
    const settings = readFileSync(
      resolve(__dirname, "../components/tabs/SettingsTab.tsx"),
      "utf-8",
    );
    expect(settings).toContain('navigate("/help")');
    expect(settings).not.toContain("TabsContent");
  });
});