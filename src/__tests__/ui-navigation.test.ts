/**
 * UI regression guard for the island page transition and the native "Web" CTA.
 *
 * Two user-visible behaviours nothing covered:
 *   1. Switching island tabs must ANIMATE the page. The bottom pill glided
 *      between tabs while the content swapped instantly underneath it, which
 *      read as a glitch on a phone.
 *   2. Inside the packaged app the top-right landing button reads "Web"; in
 *      the browser it reads "Uygulama". Either way it is a label, not a link
 *      out — pressing it returns to /dashboard, the first screen of the app
 *      you are in. It must never open the hosted site in a new tab.
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

  it("animates the secondary tabs but never the download tab", () => {
    // The download tab used to sit inside the keyed motion.div, so every tab
    // switch unmounted DownloaderCard. The WorkManager job kept running, but
    // the progress bar, the page state machine, the stall watchdog and the
    // cancel handle all died with the component and the user came back to a
    // blank form — "I switch tabs and the download stops". It now stays
    // mounted outside the animated wrapper and is merely hidden.
    const animated = dashboard.slice(
      dashboard.indexOf("<AnimatePresence"),
      dashboard.indexOf("</AnimatePresence>"),
    );
    expect(animated).not.toContain("DownloaderCard");
    expect(animated).toContain("SettingsTab");
    expect(animated).toContain("HelpTab");
    expect(animated).toContain('tab !== "download"');

    const main = dashboard.slice(dashboard.indexOf("<main"), dashboard.indexOf("</main>"));
    expect(main.indexOf("<DownloaderCard")).toBeLessThan(main.indexOf("<AnimatePresence"));
    expect(main).toMatch(/<div hidden=\{tab !== "download"\}>/);
    // History still belongs to the download section.
    expect(main).toContain("<HistoryTab />");
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

  it("takes you to /dashboard from either label — never off to another site", () => {
    // Regression guard: this button used to `window.open` vidfetch.app, which
    // bounced users out of the APK into a browser tab they could not leave.
    // Both labels belong to the same destination: the first screen of the
    // app you are already in.
    expect(landing).not.toContain("SITE_URL");
    expect(landing).not.toContain("window.open");
    expect(landing).not.toContain("openWebVersion");
    expect(landing).toContain("const openApp = () => {");
    expect(landing).toContain('navigate("/dashboard")');
    // Both header buttons must use it, not one of them bypassing it.
    const occurrences = landing.split("onClick={openApp}").length - 1;
    expect(occurrences).toBe(2);
    expect(landing).not.toContain('onClick={() => (nativeEngine ?');
  });

  it("keeps using the native engine check that drives the hero copy", () => {
    expect(landing).toContain("const nativeEngine = isNativeAvailable();");
  });
});