/**
 * VidFetch app settings — the "Ayarlar" tab.
 *
 * Two independent switches plus the AI keys, all persisted in localStorage
 * and mirrored onto <html> data attributes so CSS can react to them:
 *
 *   animations: false → html[data-anim="off"]
 *       Every CSS animation/transition is killed and framer-motion switches
 *       to reducedMotion="always". For users who find motion distracting or
 *       who want the lowest possible battery use.
 *
 *   lowPower: true → html[data-lowpower="on"]
 *       Flat look: no blur/backdrop-filter, no gradients, no shadows. Solid
 *       colors only. This is the "düşük donanım modu" for old WebViews where
 *       backdrop-filter costs real frames.
 *
 * Keys are stored on the DEVICE only (never sent anywhere). That is the same
 * trade-off the bundle-level VITE_GOOGLE_API_KEY already made; a personal
 * downloader with no accounts has nowhere safer to put them.
 */

export interface AppSettings {
  /** Master switch for all motion in the app. Default: on. */
  animations: boolean;
  /** Flat, blur-free, gradient-free look for low-end devices. Default: off. */
  lowPower: boolean;
  /** Google AI Studio key (Gemini). Empty = not configured. */
  geminiKey: string;
  /** Anthropic console key (Claude). Empty = not configured. */
  anthropicKey: string;
  /**
   * Parallel fragment downloads — the download-speed lever
   * (yt-dlp `--concurrent-fragments`). 4 = gentle on weak networks,
   * 8 = balanced, 16 = fastest (default: 16 — stock yt-dlp runs 1,
   * so DASH fetches go wide open; drop to 4/8 on a weak network, the
   * stall watchdog resumes anything that freezes either way).
   */
  fragments: number;
  /** Watch the clipboard for video links and pre-fill the URL. Default: on. */
  clipboardMonitor: boolean;
  /**
   * Mode preselected for a new download: "data" = MP4 video (default),
   * "best" = full quality, "audio" = MP3/M4A. The mode chips still
   * override it per download.
   */
  defaultMode: "best" | "data" | "audio";
  /** Remove the app's temp files after each successful download. Default: on. */
  autoCleanup: boolean;
}

/** The speed choices offered in Ayarlar (labelled Ekonomik/Dengeli/Hızlı). */
export const FRAGMENT_CHOICES = [4, 8, 16] as const;

export const DEFAULT_SETTINGS: AppSettings = {
  animations: true,
  lowPower: false,
  geminiKey: "",
  anthropicKey: "",
  fragments: 16,
  clipboardMonitor: true,
  defaultMode: "data",
  autoCleanup: true,
};

const STORAGE_KEY = "vidfetch.settings.v1";

function coerce(raw: Partial<AppSettings> | null | undefined): AppSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  return {
    // Only an explicit boolean counts: a corrupt value must not silently
    // disable motion (or enable it) behind the user's back.
    animations: typeof raw.animations === "boolean" ? raw.animations : DEFAULT_SETTINGS.animations,
    lowPower: typeof raw.lowPower === "boolean" ? raw.lowPower : DEFAULT_SETTINGS.lowPower,
    geminiKey: typeof raw.geminiKey === "string" ? raw.geminiKey.trim() : "",
    anthropicKey: typeof raw.anthropicKey === "string" ? raw.anthropicKey.trim() : "",
    // Anything outside the offered set falls back to the default — a
    // hand-edited value can never reach yt-dlp as a nonsense flag.
    fragments: FRAGMENT_CHOICES.includes(raw.fragments as (typeof FRAGMENT_CHOICES)[number])
      ? (raw.fragments as number)
      : DEFAULT_SETTINGS.fragments,
    clipboardMonitor:
      typeof raw.clipboardMonitor === "boolean"
        ? raw.clipboardMonitor
        : DEFAULT_SETTINGS.clipboardMonitor,
    defaultMode:
      raw.defaultMode === "audio" || raw.defaultMode === "best"
        ? raw.defaultMode
        : "data",
    autoCleanup:
      typeof raw.autoCleanup === "boolean" ? raw.autoCleanup : DEFAULT_SETTINGS.autoCleanup,
  };
}

/** Load settings (never throws; storage may be unavailable). */
export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return coerce(JSON.parse(raw) as Partial<AppSettings>);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persist settings. Best-effort — storage may be unavailable. */
export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable — the in-memory value still applies this session.
  }
}

/**
 * Device-power → settings, applied when the dashboard opens.
 *
 * The idea: an old/low-end phone should not start every session with blur,
 * gradients and motion on, and a strong phone should never sit in the
 * battery-saving flat mode by accident.
 *
 *   weak   (≤4 cores OR  ≤4 GB RAM) → low-power ON, animations OFF
 *   strong (≥8 cores AND ≥8 GB RAM) → low-power OFF (motion untouched)
 *   anything in between            → no change (null): the user decides.
 *
 * Pure and exported so tests can pin the thresholds; the caller passes
 * navigator.hardwareConcurrency / navigator.deviceMemory (both can be
 * undefined — an unknown device is "mid", never forced).
 */
export function autoSettingsForDevice(
  cores: number | undefined,
  memoryGB: number | undefined,
): Partial<AppSettings> | null {
  const c = typeof cores === "number" && cores > 0 ? cores : undefined;
  const m = typeof memoryGB === "number" && memoryGB > 0 ? memoryGB : undefined;
  if (c === undefined && m === undefined) return null;

  const weak = (c !== undefined && c <= 4) || (m !== undefined && m <= 4);
  if (weak) return { lowPower: true, animations: false };

  const strong = (c === undefined || c >= 8) && (m === undefined || m >= 8);
  if (strong) return { lowPower: false };

  return null;
}

/**
 * Mirror the settings onto <html> so index.css can switch the whole UI
 * without React re-rendering anything. Safe to call on every change.
 */
export function applySettings(settings: AppSettings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.anim = settings.animations ? "on" : "off";
  root.dataset.lowpower = settings.lowPower ? "on" : "off";
}