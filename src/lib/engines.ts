/**
 * Download engine routing.
 *
 * VidFetch can resolve a page URL with two different engines:
 *
 *  • **on-device** — the yt-dlp engine embedded in the Android APK / Windows
 *    EXE. Works offline, handles playlists, and offers real quality
 *    selection. This is the default and the fallback for everything.
 *
 *  • **Cobalt** — a self-hosted, Cobalt v10-compatible HTTP API
 *    (https://github.com/imputnet/cobalt). The user supplies their OWN
 *    instance URL (and API key, if that instance requires one): the hosted
 *    instances are bot-protected and explicitly not meant for third-party
 *    apps, so no instance is hard-coded here. Cobalt is genuinely better on
 *    the sites where yt-dlp most often gets blocked (TikTok, X, Instagram,
 *    Reddit, Facebook, SoundCloud) because it runs the extraction server-
 *    side with fresh cookies/session handling.
 *
 * In **auto** mode cobalt is only tried first for those sites; everything
 * else stays on the on-device engine. Whenever cobalt fails, the on-device
 * engine is tried next, so adding it can never make a download fail that
 * used to work.
 */

/**
 * Well-known Seal (yt-dlp-based Android app) API address, shown as the
 * placeholder in Ayarlar. It is NOT used automatically: sending a page URL to
 * a third-party server is the user's decision, so Seal stays "not configured"
 * until they paste an address (their own instance or the public one).
 */
export const DEFAULT_SEAL_URL = "https://api.seal.io";

export type EngineMode = "auto" | "ondevice" | "cobalt" | "server" | "seal";

/** An engine the caller should try, in order. */
export type EngineAttempt = "ondevice" | "cobalt" | "server" | "seal";

export interface EngineConfig {
  mode: EngineMode;
  /** Base URL of a Cobalt instance, e.g. https://my-instance.example */
  instance: string;
  /** Optional Authorization token (instance decides if it needs one). */
  token: string;
  /** Base URL of a self-hosted yt-dlp HTTP API (yt-dlp-web / your own box). */
  serverUrl: string;
  /** Optional bearer token for that yt-dlp API. */
  serverToken: string;
  /** Base URL of a Seal-compatible server (Seal is the yt-dlp Android app). */
  sealUrl: string;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  mode: "auto",
  instance: "",
  token: "",
  serverUrl: "",
  serverToken: "",
  sealUrl: "",
};

const STORAGE_KEY = "vidfetch.engines.v1";

/**
 * Normalize a user-typed instance URL: trims whitespace and trailing
 * slashes. Returns "" when it is not a usable http(s) URL so a typo can
 * never be saved as a working instance.
 */
export function normalizeInstance(raw: string): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (!/^https?:\/\/[^\s]+$/i.test(trimmed)) return "";
  return trimmed;
}

/** True when the user configured a usable self-hosted yt-dlp API. */
export function isServerConfigured(cfg: EngineConfig = loadEngineConfig()): boolean {
  return normalizeInstance(cfg.serverUrl).length > 0;
}

/** True when a Seal server address is available (default or user-set). */
export function isSealConfigured(cfg: EngineConfig = loadEngineConfig()): boolean {
  return normalizeInstance(cfg.sealUrl).length > 0;
}

/** True when the user configured a usable Cobalt instance. */
export function isCobaltConfigured(cfg: EngineConfig = loadEngineConfig()): boolean {
  return normalizeInstance(cfg.instance).length > 0;
}

/** Load the saved engine config (never throws; storage may be unavailable). */
export function loadEngineConfig(): EngineConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ENGINE_CONFIG };
    const parsed = JSON.parse(raw) as Partial<EngineConfig>;
    const mode: EngineMode =
      parsed.mode === "ondevice" ||
      parsed.mode === "cobalt" ||
      parsed.mode === "server" ||
      parsed.mode === "seal"
        ? parsed.mode
        : "auto";
    return {
      mode,
      instance: normalizeInstance(parsed.instance ?? ""),
      token: (parsed.token ?? "").trim(),
      serverUrl: normalizeInstance(parsed.serverUrl ?? ""),
      serverToken: (parsed.serverToken ?? "").trim(),
      sealUrl: normalizeInstance(parsed.sealUrl ?? ""),
    };
  } catch {
    return { ...DEFAULT_ENGINE_CONFIG };
  }
}

/** Persist the engine config. Best-effort — storage may be unavailable. */
export function saveEngineConfig(cfg: EngineConfig): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mode: cfg.mode,
        instance: normalizeInstance(cfg.instance),
        token: cfg.token.trim(),
        serverUrl: normalizeInstance(cfg.serverUrl),
        serverToken: cfg.serverToken.trim(),
        sealUrl: normalizeInstance(cfg.sealUrl),
      }),
    );
  } catch {
    // Storage unavailable — keep the in-memory value for this session.
  }
}

/**
 * Hosts where the Cobalt engine usually wins: sites where yt-dlp is blocked
 * by login walls or bot checks most often.
 */
const COBALT_PREFERRED_HOSTS = [
  "tiktok.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "reddit.com",
  "redd.it",
  "facebook.com",
  "fb.watch",
  "soundcloud.com",
];

/** True when Cobalt is expected to be the better resolver for this URL. */
export function cobaltPreferred(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return COBALT_PREFERRED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export interface PlanOptions {
  /** Playlist links must stay on the on-device engine (Cobalt has no playlists). */
  isPlaylist: boolean;
  mode: EngineMode;
  /** True when the native engine exists (APK/EXE). In a browser there is
   *  nothing that can write the file to disk, so cobalt cannot help. */
  native: boolean;
}

/**
 * Ordered list of engines to try for this URL. Always ends with "ondevice"
 * (unless there is no native engine at all), so a failed cobalt call can
 * never break a download that used to work.
 */
export function planEngines(url: string, opts: PlanOptions): EngineAttempt[] {
  const { mode, isPlaylist, native } = opts;
  const configured = isCobaltConfigured();

  // No native engine (plain browser): nothing can download to disk, and the
  // on-device path also owns the optional server fallback + "no engine" copy.
  if (!native) return ["ondevice"];

  if (mode === "ondevice") return ["ondevice"];

  if (mode === "cobalt") {
    return configured ? ["cobalt", "ondevice"] : ["ondevice"];
  }

  // A self-hosted yt-dlp API returns real format lists, so it is also a good
  // first choice when the user picked it explicitly.
  if (mode === "server") {
    return isServerConfigured() ? ["server", "ondevice"] : ["ondevice"];
  }

  // Seal speaks the same JSON dialect, so it slots in the same way.
  if (mode === "seal") {
    return isSealConfigured() ? ["seal", "ondevice"] : ["ondevice"];
  }

  // auto
  if (isPlaylist) return ["ondevice"];
  if (configured && cobaltPreferred(url)) return ["cobalt", "ondevice"];
  if (isServerConfigured()) return ["server", "ondevice"];
  return ["ondevice"];
}

/**
 * Last-resort fallback: when the on-device engine failed (e.g. a YouTube bot
 * check) but cobalt is configured and was not tried yet, give it one shot.
 * Returns null when there is nothing left to try.
 */
export function lastResortEngine(
  url: string,
  tried: EngineAttempt[],
  mode: EngineMode,
): EngineAttempt | null {
  if (mode === "ondevice") return null;

  // Seal and the self-hosted server are tried in this order, each only once,
  // and never for links the HTTP engines cannot handle (playlists).
  const candidates: EngineAttempt[] = ["cobalt", "server", "seal"];
  const isPlaylistUrl = /[?&]list=[^&\s]+/.test(url) || /\/playlist([/?]|$)/.test(url);

  for (const engine of candidates) {
    if (tried.includes(engine)) continue;
    if (engine === "cobalt") {
      if (!isCobaltConfigured()) continue;
      if (!cobaltPreferred(url)) continue;
      return "cobalt";
    }
    if (engine === "server") {
      if (!isServerConfigured()) continue;
      // The on-device engine owns playlists, so leave those alone.
      if (isPlaylistUrl) continue;
      return "server";
    }
    if (!isSealConfigured()) continue;
    if (isPlaylistUrl) continue;
    return "seal";
  }
  return null;
}

/** Human-readable label for an engine (TR + EN). */
export function engineLabel(engine: EngineAttempt, lang: "tr" | "en"): string {
  if (engine === "cobalt") return "Cobalt";
  if (engine === "server") return lang === "tr" ? "yt-dlp sunucusu" : "yt-dlp server";
  if (engine === "seal") return "Seal";
  return lang === "tr" ? "Cihaz içi motor" : "On-device engine";
}

/** One-line explanation of the active routing, shown in Settings. */
export function describeRouting(cfg: EngineConfig, lang: "tr" | "en"): string {
  if (cfg.mode === "ondevice")
    return lang === "tr"
      ? "Tüm indirmeler cihazdaki motorla yapılır."
      : "Every download uses the on-device engine.";
  if (cfg.mode === "server")
    return isServerConfigured(cfg)
      ? lang === "tr"
        ? "Önce kendi yt-dlp sunucunuz, başarısız olursa cihaz motoru."
        : "Your yt-dlp server first, falling back to the on-device engine."
      : lang === "tr"
        ? "yt-dlp sunucu adresi girilmedi — cihaz motoru kullanılıyor."
        : "No yt-dlp server set — the on-device engine is used.";
  if (cfg.mode === "seal")
    return lang === "tr"
      ? "Önce Seal sunucusu, başarısız olursa cihaz motoru."
      : "Seal first, falling back to the on-device engine.";
  if (!isCobaltConfigured(cfg))
    return lang === "tr"
      ? "Cobalt kurulu değil — şu an tüm indirmeler cihazdaki motorla yapılır."
      : "Cobalt is not configured — everything currently uses the on-device engine.";
  if (cfg.mode === "cobalt")
    return lang === "tr"
      ? "Cobalt önce denenir, başarısız olursa cihaz motoruna düşülür."
      : "Cobalt is tried first, falling back to the on-device engine.";
  if (isServerConfigured(cfg))
    return lang === "tr"
      ? "Otomatik: seçili sitelerde Cobalt, kalanlarda kendi yt-dlp sunucunuz; son çare Seal ve cihaz motoru."
      : "Auto: Cobalt on supported sites, your yt-dlp server elsewhere; Seal and the on-device engine as last resorts.";
  return lang === "tr"
    ? "Otomatik: TikTok/X/Instagram/Reddit/Facebook/SoundCloud için Cobalt, geri kalan her şey cihaz motoru."
    : "Auto: Cobalt for TikTok/X/Instagram/Reddit/Facebook/SoundCloud, on-device engine for everything else.";
}