/**
 * UI regression guard for the island page transition and the native "Web" CTA.
 *
 * Two user-visible behaviours nothing covered:
 *   1. Switching island tabs must ANIMATE the page. The bottom pill glided
 *      between tabs while the content swapped instantly underneath it, which
 *      read as a glitch on a phone.
 *   2. Inside the packaged app the top-right landing button used to say
 *      "Uygulama" and navigate to /dashboard — the page you were already on.
 *      In the app it must read "Web" and hand off to the hosted site.
 *
 * These assertions read the sources, same pattern as theme.test.ts: the
 * behaviour is CSS/framer-motion and platform detection, neither of which a
 * jsdom render here would exercise faithfully.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8");

const dashboard = read("pages/Dashboard.tsx");
const landing = read("pages/Landing.tsx");
const main = read("main.tsx");

describe("island tab switch animates the page", () => {
  it("cross-fades between tabs with AnimatePresence mode=wait", () => {
    expect(dashboard).toContain(
      'import { AnimatePresence, motion } from "framer-motion"',
    );
    // mode="wait" so the outgoing page leaves BEFORE the new one enters —
    // otherwise both are mounted mid-transition and the layout jumps.
    expect(dashboard).toContain('<AnimatePresence mode="wait" initial={false}>');
    // Keyed on the tab: this is what actually triggers enter/exit.
    expect(dashboard).toMatch(/<motion\.div\s+key=\{tab\}/);
  });

  it("animates opacity and transform only (compositor-safe)", () => {
    const block = dashboard.slice(
      dashboard.indexOf("<AnimatePresence"),
      dashboard.indexOf("</AnimatePresence>"),
    );
    expect(block).toContain("initial={{ opacity: 0, y: 10 }}");
    expect(block).toContain("animate={{ opacity: 1, y: 0 }}");
    expect(block).toContain("exit={{ opacity: 0, y: -6 }}");
    // No width/height/maxHeight animation: those force layout on every frame
    // and are what makes cheap Android WebViews drop frames.
    expect(block).not.toMatch(/\{[^}]*\b(width|height|maxHeight|top|left)\s*:/);
  });

  it("keeps a short duration and a named easing curve", () => {
    const block = dashboard.slice(
      dashboard.indexOf("<AnimatePresence"),
      dashboard.indexOf("</AnimatePresence>"),
    );
    expect(block).toMatch(/duration: 0\.\d+/);
    expect(block).toContain("ease: [0.22, 1, 0.36, 1]");
  });

  it("is still inside the reduced-motion policy", () => {
    // The policy moved behind the Ayarlar switch: "user" (respect the OS) by
    // default, "always" (no motion at all) when the user turns animations
    // off. Either way the tab animation must stay inside it.
    expect(main).toContain("reducedMotion={settings.animations ?");
    expect(main).toContain('"user" : "always"');
    // No local MotionConfig override that would opt back into "always".
    expect(dashboard).not.toContain("<MotionConfig");
  });

  it("still renders both tabs inside the animated wrapper", () => {
    const block = dashboard.slice(
      dashboard.indexOf("<AnimatePresence"),
      dashboard.indexOf("</AnimatePresence>"),
    );
    expect(block).toContain("DownloaderCard");
    expect(block).toContain("SettingsTab");
    expect(block).toContain("HistoryTab");
  });
});

describe("top-right CTA is context aware", () => {
  it('reads "Web" in the app and "Uygulama" in the browser', () => {
    expect(landing).toContain(
      '{nativeEngine ? "Web" : "Uygulama"}',
    );
    // Exactly the two buttons in the header (desktop nav + mobile-only).
    const occurrences = landing.split('{nativeEngine ? "Web" : "Uygulama"}').length - 1;
    expect(occurrences).toBe(2);
  });

  it("opens the hosted site when in the app instead of re-navigating", () => {
    expect(landing).toContain('const SITE_URL = "https://vidfetch.app"');
    expect(landing).toContain("window.open(SITE_URL, \"_blank\", \"noopener,noreferrer\")");
    // The branch must be a real conditional, not a dead ternary.
    expect(landing).toContain(
      'onClick={() => (nativeEngine ? openWebVersion() : navigate("/dashboard"))}',
    );
  });

  it("keeps using the native engine check that drives the hero copy", () => {
    expect(landing).toContain("const nativeEngine = isNativeAvailable();");
  });
});