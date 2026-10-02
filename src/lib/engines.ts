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

export type EngineMode = "auto" | "ondevice" | "cobalt";

/** An engine the caller should try, in order. */
export type EngineAttempt = "ondevice" | "cobalt";

export interface EngineConfig {
  mode: EngineMode;
  /** Base URL of a Cobalt instance, e.g. https://my-instance.example */
  instance: string;
  /** Optional Authorization token (instance decides if it needs one). */
  token: string;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  mode: "auto",
  instance: "",
  token: "",
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
      parsed.mode === "ondevice" || parsed.mode === "cobalt" ? parsed.mode : "auto";
    return {
      mode,
      instance: normalizeInstance(parsed.instance ?? ""),
      token: (parsed.token ?? "").trim(),
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

  // auto
  if (isPlaylist) return ["ondevice"];
  if (configured && cobaltPreferred(url)) return ["cobalt", "ondevice"];
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
  if (tried.includes("cobalt")) return null;
  if (!isCobaltConfigured()) return null;
  // Don't bother for links the engine simply does not support (e.g. playlists).
  if (!cobaltPreferred(url)) return null;
  return "cobalt";
}

/** Human-readable label for an engine (TR + EN). */
export function engineLabel(engine: EngineAttempt, lang: "tr" | "en"): string {
  if (engine === "cobalt") return lang === "tr" ? "Cobalt" : "Cobalt";
  return lang === "tr" ? "Cihaz içi motor" : "On-device engine";
}

/** One-line explanation of the active routing, shown in Settings. */
export function describeRouting(cfg: EngineConfig, lang: "tr" | "en"): string {
  if (cfg.mode === "ondevice")
    return lang === "tr"
      ? "Tüm indirmeler cihazdaki motorla yapılır."
      : "Every download uses the on-device engine.";
  if (!isCobaltConfigured(cfg))
    return lang === "tr"
      ? "Cobalt kurulu değil — şu an tüm indirmeler cihazdaki motorla yapılır."
      : "Cobalt is not configured — everything currently uses the on-device engine.";
  if (cfg.mode === "cobalt")
    return lang === "tr"
      ? "Cobalt önce denenir, başarısız olursa cihaz motoruna düşülür."
      : "Cobalt is tried first, falling back to the on-device engine.";
  return lang === "tr"
    ? "Otomatik: TikTok/X/Instagram/Reddit/Facebook/SoundCloud için Cobalt, geri kalan her şey cihaz motoru."
    : "Auto: Cobalt for TikTok/X/Instagram/Reddit/Facebook/SoundCloud, on-device engine for everything else.";
}