/**
 * Web-download regression tests.
 *
 * Shipped bug: "dashboardda indirme yapamiyorum" — in a plain browser (the
 * hosted site / preview) the card dead-ended at "no engine here", because the
 * only resolver the browser could reach was a Cobalt instance the user had to
 * configure by hand, and the download step itself only knew how to ask the
 * native engine.
 *
 * The fix, asserted here at the source level (no DOM in this suite):
 *   1. engines.ts ships built-in Cobalt fallbacks and a browser plan that uses
 *      them, with on-device kept last as the honest fallback.
 *   2. DownloaderCard resolves through EVERY configured+built-in instance and
 *      never leaks the user's API token to a third-party fallback.
 *   3. ytdlp-native hands an already-resolved media URL to the browser's own
 *      download manager (Cobalt tunnels answer with Content-Disposition:
 *      attachment, so the click saves the file).
 *   4. A shared watch link that also carries &list= is ONE video again (the
 *      same rule yt-dlp applies), so it can be analyzed in a browser at all.
 *   5. A single-link analysis clears any stale multi-link queue — while the
 *      queue panel is open it hides every other screen, which made the
 *      history / clipboard download buttons look dead.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (...p: string[]) =>
  readFileSync(resolve(__dirname, "../..", ...p), "utf-8");

const engines = read("src/lib/engines.ts");
const native = read("src/lib/ytdlp-native.ts");
const card = read("src/components/DownloaderCard.tsx");

// ─── engines.ts — built-in resolver fallbacks ────────────────────────────────

describe("browser engine routing", () => {
  it("ships at least one built-in Cobalt fallback instance", () => {
    expect(engines).toContain("export const DEFAULT_COBALT_INSTANCES");
    // Every entry must be a plain https URL — it is dialed from the page.
    const listMatch = engines.match(
      /export const DEFAULT_COBALT_INSTANCES = \[([^\]]+)\]/,
    );
    expect(listMatch, "DEFAULT_COBALT_INSTANCES not found").not.toBeNull();
    const entries = (listMatch?.[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry).toMatch(/^https:\/\/\S+$/);
    }
  });

  it("offers the built-ins only as a fallback behind the user's instance", () => {
    expect(engines).toContain("export function cobaltInstances(");
    // The user's own address is first in the order.
    expect(engines).toMatch(
      /normalizeInstance\(cfg\.instance\),\s*\.\.\.DEFAULT_COBALT_INSTANCES/,
    );
  });

  it("routes the browser to cobalt, keeping on-device as the last resort", () => {
    // The whole `if (!native) { … }` branch, up to its closing brace.
    const browserBranch =
      engines.match(/if \(!native\) \{[\s\S]{0,900}?\n {2}\}/)?.[0] ?? "";
    expect(browserBranch.length).toBeGreaterThan(0);
    // Cobalt is always in the plan; on-device always closes it.
    expect(browserBranch).toContain('plan.push("cobalt", "ondevice");');
    expect(browserBranch).toContain("return plan;");
    // Playlists stay on the on-device path — cobalt has no playlists.
    expect(browserBranch).toContain('if (isPlaylist) return ["ondevice"];');
    // An explicit on-device choice still wins in the browser.
    expect(browserBranch).toContain('if (mode === "ondevice") return ["ondevice"];');
    // A configured self-hosted server / Seal server is honored in the browser
    // too — the page saves the resolved URL itself.
    expect(browserBranch).toContain(
      'if (mode === "server" && isServerConfigured()) plan.push("server");',
    );
  });
});

// ─── DownloaderCard — resolution + analysis entry points ────────────────────

describe("cobalt resolution in the card", () => {
  it("tries every instance instead of only the configured one", () => {
    expect(card).toContain("for (const instance of cobaltInstances(cfg))");
  });

  it("never sends the user's API token to a built-in fallback", () => {
    expect(card).toContain(
      "token: instance === cfg.instance ? cfg.token || undefined : undefined,",
    );
  });

  it("passes the resolved media URL to the browser download path", () => {
    expect(card).toContain("directMedia: !!directUrl && !nativeAvailable,");
    expect(card).toContain("fileName: videoInfo?.title,");
  });

  it("treats a watch link that carries &list= as ONE video", () => {
    // Same rule as yt-dlp: the video wins; only /playlist-style URLs open a
    // list. In a browser, where playlists cannot be analyzed, the old rule
    // failed those shared links outright.
    const fn = card.slice(
      card.indexOf("function looksLikePlaylist"),
      card.indexOf("const STALLED_DOWNLOAD_MS"),
    );
    expect(fn).toContain('if (/[?&]v=[^&\\s]+/.test(raw)) return false;');
  });

  it("clears a stale multi-link queue when a single link is analyzed", () => {
    const analyze = card.slice(
      card.indexOf("const runAnalyze = useCallback("),
      card.indexOf("const handleAnalyze = useCallback("),
    );
    expect(analyze).toContain("clearQueueList();");
  });

  it("runs the analysis from the clipboard card's İndir button", () => {
    expect(card).toMatch(
      /onDownload=\{\(detected\) => \{[\s\S]{0,400}?void runAnalyze\(detected\);/,
    );
  });
});

// ─── ytdlp-native — the browser save path ────────────────────────────────────

describe("browser download hand-off", () => {
  it("declares the directMedia option and a file name", () => {
    expect(native).toContain("directMedia?: boolean;");
    expect(native).toContain("fileName?: string;");
  });

  it("hands a resolved media URL to the browser's download manager", () => {
    expect(native).toContain("export function triggerBrowserDownload(");
    expect(native).toContain("if (directMedia && /^https?:\\/\\//i.test(url))");
    expect(native).toContain('return "web-download";');
    // The click is a real anchor download, detached from the DOM afterwards.
    expect(native).toContain("a.click();");
  });

  it("reports completion so the UI leaves the progress screen", () => {
    const start = native.indexOf("if (directMedia && /^https?:\\/\\//i.test(url))");
    // Search AFTER the branch: `if (serverConfigured())` also appears earlier,
    // in getVideoInfo.
    const branch = native.slice(
      start,
      native.indexOf("if (serverConfigured())", start),
    );
    expect(branch.length).toBeGreaterThan(0);
    expect(branch).toContain("onProgress?.({ percent: 100");
    expect(branch).toContain("onComplete?.({ uri: url, fileName: name })");
  });

  it("shows browser-appropriate completion copy instead of a native path", () => {
    expect(card).toContain(
      "Tarayıcının indirme panelinden indirmeyi takip edebilirsin.",
    );
    // The "Open video" button must work outside the native apps too.
    expect(card).toContain("window.open(");
  });
});
