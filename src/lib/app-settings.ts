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
}

export const DEFAULT_SETTINGS: AppSettings = {
  animations: true,
  lowPower: false,
  geminiKey: "",
  anthropicKey: "",
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
 * Mirror the settings onto <html> so index.css can switch the whole UI
 * without React re-rendering anything. Safe to call on every change.
 */
export function applySettings(settings: AppSettings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.anim = settings.animations ? "on" : "off";
  root.dataset.lowpower = settings.lowPower ? "on" : "off";
}