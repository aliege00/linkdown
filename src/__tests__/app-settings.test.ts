/**
 * Guards for the settings / low-power / playlist / release changes.
 *
 * Two kinds of test in here:
 *  • real unit tests for the pure settings + engine logic;
 *  • source assertions for the wiring (a switch that exists but is never
 *    applied to <html> would look fine in a snapshot and do nothing).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  applySettings,
  autoSettingsForDevice,
} from "@/lib/app-settings";
import {
  DEFAULT_ENGINE_CONFIG,
  loadEngineConfig,
  saveEngineConfig,
  planEngines,
  lastResortEngine,
  isSealConfigured,
  isServerConfigured,
  describeRouting,
} from "@/lib/engines";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8");

/**
 * The suite runs in the default (node) environment, so there is no real
 * localStorage or document. Both are stubbed per test — app-settings only
 * uses getItem/setItem and documentElement.dataset, so a tiny fake is enough
 * and avoids pulling a whole DOM implementation into the test run.
 */
function stubBrowser() {
  const store = new Map<string, string>();
  const dataset: Record<string, string> = {};
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  (globalThis as unknown as { document: Document }).document = {
    documentElement: { dataset },
  } as unknown as Document;
  return { store, dataset };
}

describe("app settings", () => {
  beforeEach(() => {
    stubBrowser();
  });

  it("defaults to animations on and low-power off", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.animations).toBe(true);
    expect(DEFAULT_SETTINGS.lowPower).toBe(false);
    // Speed ships at the FAST profile (yt-dlp's own default is 1 fragment);
    // the other new switches default to the helpful state.
    expect(DEFAULT_SETTINGS.fragments).toBe(16);
    expect(DEFAULT_SETTINGS.clipboardMonitor).toBe(true);
    expect(DEFAULT_SETTINGS.defaultMode).toBe("data");
    expect(DEFAULT_SETTINGS.autoCleanup).toBe(true);
  });

  it("round-trips every field through localStorage", () => {
    saveSettings({
      animations: false,
      lowPower: true,
      geminiKey: "AIza-test",
      anthropicKey: "sk-ant-test",
      fragments: 16,
      clipboardMonitor: false,
      defaultMode: "audio",
      autoCleanup: false,
    });
    expect(loadSettings()).toEqual({
      animations: false,
      lowPower: true,
      geminiKey: "AIza-test",
      anthropicKey: "sk-ant-test",
      fragments: 16,
      clipboardMonitor: false,
      defaultMode: "audio",
      autoCleanup: false,
    });
  });

  it("rejects an unknown speed, mode or toggle value instead of passing it on", () => {
    // A hand-edited preference must never reach yt-dlp as a nonsense flag.
    localStorage.setItem(
      "vidfetch.settings.v1",
      JSON.stringify({ fragments: 64, defaultMode: "hacked", clipboardMonitor: "yes" }),
    );
    const loaded = loadSettings();
    expect(loaded.fragments).toBe(DEFAULT_SETTINGS.fragments);
    expect(loaded.defaultMode).toBe("data");
    expect(loaded.clipboardMonitor).toBe(true);
  });

  it("falls back to the defaults on corrupt storage instead of throwing", () => {
    localStorage.setItem("vidfetch.settings.v1", "{not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("ignores non-boolean values for the two switches", () => {
    localStorage.setItem(
      "vidfetch.settings.v1",
      JSON.stringify({ animations: "no", lowPower: 1, geminiKey: " k " }),
    );
    const loaded = loadSettings();
    expect(loaded.animations).toBe(true);
    expect(loaded.lowPower).toBe(false);
    expect(loaded.geminiKey).toBe("k"); // trimmed
  });

  it("mirrors both switches onto <html> for the CSS layer", () => {
    applySettings({ ...DEFAULT_SETTINGS, animations: false, lowPower: true });
    expect(document.documentElement.dataset.anim).toBe("off");
    expect(document.documentElement.dataset.lowpower).toBe("on");

    applySettings(DEFAULT_SETTINGS);
    expect(document.documentElement.dataset.anim).toBe("on");
    expect(document.documentElement.dataset.lowpower).toBe("off");
  });
});

describe("device-power auto settings (dashboard entry)", () => {
  it("puts a weak device into low-power with motion off", () => {
    expect(autoSettingsForDevice(4, 8)).toEqual({ lowPower: true, animations: false });
    expect(autoSettingsForDevice(8, 3)).toEqual({ lowPower: true, animations: false });
  });

  it("switches low-power OFF on a strong device without touching motion", () => {
    expect(autoSettingsForDevice(8, 8)).toEqual({ lowPower: false });
    expect(autoSettingsForDevice(12, 16)).toEqual({ lowPower: false });
  });

  it("leaves mid-range and unknown devices to the user", () => {
    expect(autoSettingsForDevice(6, 6)).toBeNull();
    // Unknown hardwareConcurrency/deviceMemory must never force a mode.
    expect(autoSettingsForDevice(undefined, undefined)).toBeNull();
    expect(autoSettingsForDevice(0, 0)).toBeNull();
    // One known strong signal, one unknown → strong.
    expect(autoSettingsForDevice(8, undefined)).toEqual({ lowPower: false });
    // One known weak signal wins over an unknown.
    expect(autoSettingsForDevice(undefined, 3)).toEqual({ lowPower: true, animations: false });
  });

  it("is applied on dashboard mount, not on every settings change", () => {
    const dashboard = read("pages/Dashboard.tsx");
    expect(dashboard).toContain("autoSettingsForDevice(");
    expect(dashboard).toContain("navigator.hardwareConcurrency");
    expect(dashboard).toContain("deviceMemory");
    // Mount-only: the effect must not re-run on settings changes or it
    // would fight every manual toggle in Ayarlar.
    expect(dashboard).toMatch(/\}, \[\]\);/);
  });
});

describe("settings styling", () => {
  const css = read("index.css");

  it("kills animation/transition when animations are turned off", () => {
    expect(css).toContain('html[data-anim="off"]');
    expect(css).toMatch(/html\[data-anim="off"\][\s\S]{0,400}transition-duration: 0\.01ms/);
  });

  it("flattens the UI in low-power mode (no blur, no gradients)", () => {
    expect(css).toContain('html[data-lowpower="on"]');
    expect(css).toMatch(/backdrop-filter: none !important/);
    expect(css).toMatch(/\[class\*="bg-gradient-to-"\][\s\S]{0,160}background-image: none !important/);
  });

  it("keeps the template's Tailwind import and theme tokens intact", () => {
    expect(css).toContain('@import "tailwindcss"');
    expect(css).toContain("--primary:");
    expect(css).toContain(".dark {");
  });
});

describe("navigation: island has three items", () => {
  const bar = read("components/BottomTabBar.tsx");
  const dashboard = read("pages/Dashboard.tsx");

  it("offers İndirme, Yardım and Ayarlar", () => {
    expect(bar).toContain('id: "download"');
    expect(bar).toContain('id: "support"');
    expect(bar).toContain('id: "settings"');
    expect(bar).toContain('label: "Ayarlar"');
    expect(bar).toContain("Settings2");
  });

  it("sizes the sliding pill to a third of the island", () => {
    // A hard-coded 50% width would leave the third tab without a pill.
    expect(bar).not.toContain("w-[calc(50%-0.25rem)]");
    expect(bar).toContain("${100 / TABS.length}%");
  });

  it("routes all three tabs in the dashboard", () => {
    expect(dashboard).toContain('tab === "settings"');
    expect(dashboard).toContain("<SettingsTab />");
    expect(dashboard).toContain("<HelpTab />");
  });
});

describe("page transitions", () => {
  it("animates route changes", () => {
    const transition = read("components/PageTransition.tsx");
    expect(transition).toContain('key={location.pathname}');
    expect(transition).toContain('mode="wait"');
    expect(transition).toMatch(/initial=\{\{ opacity: 0/);
    expect(read("main.tsx")).toContain("<PageTransition>");
  });
});

describe("help center tap bug", () => {
  it("does not make the whole help card look pressed", () => {
    const help = read("components/HelpCenter.tsx");
    // The card is a container, not a target: `interactive` gave it
    // cursor-pointer + active:scale, so any tap lit up all of it.
    expect(help).not.toContain("<FlatCard interactive>");
  });
});

describe("playlist", () => {
  const card = read("components/DownloaderCard.tsx");

  it("shows the video list instead of auto-downloading everything", () => {
    // The old auto-start called downloadPlaylistRef straight after analyze.
    expect(card).not.toContain("downloadPlaylistRef.current();");
  });

  it("offers a per-video download button", () => {
    expect(card).toContain("onDownloadOne");
    expect(card).toContain("handleDownloadPlaylistEntry");
  });

  it("localizes the 100-video cap note", () => {
    expect(card).toContain("İlk 100 video gösteriliyor");
  });
});

describe("AI keys", () => {
  it("reads the key from settings first, env second", () => {
    const gemini = read("lib/gemini.ts");
    expect(gemini).toContain("loadSettings().geminiKey");
    expect(gemini).toContain("VITE_GOOGLE_API_KEY");
    expect(read("lib/anthropic.ts")).toContain("loadSettings().anthropicKey");
    expect(read("lib/ai.ts")).toContain("isAnthropicAvailable");
  });

  it("offers both key fields in the Ayarlar tab with a place to get one", () => {
    const settings = read("components/tabs/SettingsTab.tsx");
    expect(settings).toContain("geminiKey");
    expect(settings).toContain("anthropicKey");
    expect(settings).toContain("https://aistudio.google.com/apikey");
    expect(settings).toContain("https://console.anthropic.com/settings/keys");
  });
});

describe("engines", () => {
  beforeEach(() => {
    stubBrowser();
  });

  it("keeps every HTTP engine opt-in", () => {
    expect(isServerConfigured(DEFAULT_ENGINE_CONFIG)).toBe(false);
    expect(isSealConfigured(DEFAULT_ENGINE_CONFIG)).toBe(false);
  });

  it("persists the yt-dlp server and seal addresses", () => {
    saveEngineConfig({
      ...DEFAULT_ENGINE_CONFIG,
      serverUrl: "https://ytdlp.example.com",
      serverToken: "tok",
      sealUrl: "https://seal.example.com",
    });
    const cfg = loadEngineConfig();
    expect(cfg.serverUrl).toBe("https://ytdlp.example.com");
    expect(cfg.sealUrl).toBe("https://seal.example.com");
  });

  it("falls back to the on-device engine when a server is not configured", () => {
    expect(planEngines("https://x.com/a", { isPlaylist: false, mode: "server", native: true }))
      .toEqual(["ondevice"]);
    expect(planEngines("https://x.com/a", { isPlaylist: false, mode: "seal", native: true }))
      .toEqual(["ondevice"]);
  });

  it("tries a configured server before the on-device engine", () => {
    saveEngineConfig({ ...DEFAULT_ENGINE_CONFIG, serverUrl: "https://ytdlp.example.com" });
    expect(planEngines("https://youtube.com/watch?v=1", { isPlaylist: false, mode: "server", native: true }))
      .toEqual(["server", "ondevice"]);
    // A browser has no engine that can write to disk.
    expect(planEngines("https://youtube.com/watch?v=1", { isPlaylist: false, mode: "server", native: false }))
      .toEqual(["ondevice"]);
  });

  it("never rescues a link into an unconfigured engine", () => {
    expect(
      lastResortEngine("https://tiktok.com/@a/video/1", [], "auto"),
    ).toBeNull();
  });

  it("still never hands a playlist to an HTTP engine", () => {
    saveEngineConfig({
      ...DEFAULT_ENGINE_CONFIG,
      serverUrl: "https://ytdlp.example.com",
      sealUrl: "https://seal.example.com",
    });
    expect(
      lastResortEngine("https://youtube.com/playlist?list=PL1", ["ondevice"], "auto"),
    ).toBeNull();
  });
});

describe("on-device app handoff", () => {
  beforeEach(() => {
    stubBrowser();
  });

  it("round-trips the handoff choice and rejects unknown ids", () => {
    saveEngineConfig({ ...DEFAULT_ENGINE_CONFIG, handoff: "seal" });
    expect(loadEngineConfig().handoff).toBe("seal");
    // The fourth on-device engine round-trips too.
    saveEngineConfig({ ...DEFAULT_ENGINE_CONFIG, handoff: "libretube" });
    expect(loadEngineConfig().handoff).toBe("libretube");
    // A stale/unknown value collapses to "disabled" — never a ghost app.
    localStorage.setItem("vidfetch.engines.v1", JSON.stringify({ handoff: "safari" }));
    expect(loadEngineConfig().handoff).toBe("");
    // Legacy configs without the field read as disabled.
    localStorage.setItem("vidfetch.engines.v1", JSON.stringify({ mode: "auto" }));
    expect(loadEngineConfig().handoff).toBe("");
  });

  it("keeps analysis on-device when a handoff app owns the download", () => {
    expect(
      planEngines("https://youtube.com/watch?v=1", {
        isPlaylist: false,
        mode: "auto",
        native: true,
        handoff: "seal",
      }),
    ).toEqual(["ondevice"]);
    // Even an explicitly chosen HTTP engine stays out of the way — the other
    // app fetches the URL itself.
    expect(
      planEngines("https://tiktok.com/@a/video/1", {
        isPlaylist: false,
        mode: "cobalt",
        native: true,
        handoff: "newpipe",
      }),
    ).toEqual(["ondevice"]);
  });

  it("describes the handoff in Ayarlar", () => {
    const line = describeRouting({ ...DEFAULT_ENGINE_CONFIG, handoff: "ytdlnis" }, "tr");
    expect(line).toContain("ytdlnis");
    expect(line).toContain("cihazda");
    // The default (no handoff) keeps the mode-based descriptions.
    expect(describeRouting(DEFAULT_ENGINE_CONFIG, "tr")).not.toContain("gönderilir");
  });
});

describe("handoff wiring in the card and the native bridge", () => {
  const card = read("components/DownloaderCard.tsx");
  const native = read("lib/ytdlp-native.ts");

  it("hands off single, playlist and per-entry downloads", () => {
    expect(card).toContain("const handoff = loadEngineConfig().handoff;");
    const branches = (card.match(/openInEngine\(handoff,/g) ?? []).length;
    expect(branches, "single + playlist + entry").toBe(3);
    // The complete screen explains where the download went.
    expect(card).toContain("setHandoffApp(handoff)");
    expect(card).toContain("handoffLabel(handoffApp)");
  });

  it("exposes the two plugin calls and the fragments option", () => {
    expect(native).toContain("getInstalledEngines(): Promise<Record<string, boolean>>");
    expect(native).toContain("openInEngine(options: { engine: string; url: string })");
    expect(native).toContain("fragments?: number");
    // The card forwards the speed setting on every startDownload.
    expect(card).toContain("fragments,");
  });
});

describe("settings applied where downloads actually start", () => {
  const card = read("components/DownloaderCard.tsx");
  const tab = read("components/tabs/SettingsTab.tsx");

  it("Ayarlar offers speed, default mode, both toggles and the app list", () => {
    expect(tab).toContain("FRAGMENT_CHOICES");
    expect(tab).toContain("update({ fragments: value })");
    expect(tab).toContain("İndirme hızı");
    expect(tab).toContain("update({ defaultMode: mode.id })");
    expect(tab).toContain("update({ clipboardMonitor: next })");
    expect(tab).toContain("update({ autoCleanup: next })");
    expect(tab).toContain("HANDOFF_APPS");
    expect(tab).toContain("persistEngines({ handoff:");
    expect(tab).toContain("getInstalledEngines");
  });

  it("the download card consumes them", () => {
    expect(card).toContain("enabled: settings.clipboardMonitor");
    expect(card).toContain("() => settings.defaultMode");
    expect(card).toContain("if (autoCleanup) postDownloadCleanup");
    expect(card).toContain("const fragments = settings.fragments;");
  });
});

describe("server engines", () => {
  it("wraps a resolution with a direct URL and one synthetic format", async () => {
    const { infoFromServer, SERVER_FORMAT_ID, SEAL_FORMAT_ID } = await import(
      "@/lib/server-engines"
    );
    const info = infoFromServer(
      "https://youtube.com/watch?v=1",
      {
        directUrl: "https://cdn.example.com/video.mp4",
        title: "Test",
        thumbnail: null,
        engine: "seal",
        service: "https://seal.example.com",
      },
      { audioOnly: false, requestedQuality: "720" },
    );
    expect(info.engine).toBe("seal");
    expect(info.direct_url).toBe("https://cdn.example.com/video.mp4");
    expect(info.formats).toHaveLength(1);
    expect(info.formats[0].format_id).toBe(SEAL_FORMAT_ID);
    // The strict format filter needs a real container + resolution label.
    expect(info.formats[0].ext).toBe("mp4");
    expect(info.formats[0].resolution).toBe("720p");
    expect(SERVER_FORMAT_ID).not.toBe(SEAL_FORMAT_ID);
  });
});

describe("release without a keystore", () => {
  const release = readFileSync(
    resolve(__dirname, "../../.github/workflows/release.yml"),
    "utf-8",
  );
  const buildApk = readFileSync(
    resolve(__dirname, "../../.github/workflows/build-apk.yml"),
    "utf-8",
  );

  it("warns instead of failing the build", () => {
    // The signing step must no longer be fatal (a missing APK still is).
    expect(release).toContain("DEBUG-signed APK");
    expect(release).toContain('echo "unsigned=true" >> "$GITHUB_OUTPUT"');
    expect(release).not.toContain("❌ Signing secrets missing");
    expect(buildApk).toContain("DEBUG-signed APK");
    expect(buildApk).not.toContain("this is the release job refusing to ship");
  });

  it("labels an unsigned release as a pre-release", () => {
    expect(release).toContain("prerelease: ${{ needs.build-apk.outputs.unsigned == 'true' || inputs.prerelease == true }}");
    // The boolean comparison is load-bearing: on a tag push the declared
    // inputs resolve to the STRING "false", and `inputs.prerelease || …`
    // would take that truthy string and publish a full release instead.
    expect(release).not.toContain("inputs.prerelease ||");
    expect(release).not.toContain("inputs.draft ||");
    expect(release).toContain("draft: ${{ inputs.draft == true }}");
  });

  it("still uses the keystore whenever the secrets exist", () => {
    expect(release).toContain("echo \"$SIGNING_KEY\" | base64 --decode");
    expect(release).toContain("SIGNING_STORE_FILE=$PWD/android/app/release.keystore");
  });
});

describe("settings hook", () => {
  it("never throws outside the provider", async () => {
    vi.resetModules();
    const { useAppSettings } = await import("@/hooks/use-app-settings");
    expect(typeof useAppSettings).toBe("function");
  });
});