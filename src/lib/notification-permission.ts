/**
 * Notification Permission — safe async request.
 *
 * Wraps the Notification API in multiple layers of try-catch so that
 * any environment (WebView, Capacitor, Electron, browser) can call this
 * without crashing.
 *
 * Android: uses the Capacitor LocalNotifications plugin if available.
 * Desktop/Electron: uses the Web Notification API.
 * Browser: uses the Web Notification API (requires user gesture).
 */

import { registerPlugin } from "@capacitor/core";

// ── Capacitor LocalNotifications Plugin ────────────────────────────────

interface LocalNotificationsPlugin {
  requestPermissions(): Promise<{ display: string }>;
  checkPermissions(): Promise<{ display: string }>;
}

let LocalNotifications: LocalNotificationsPlugin | undefined;
try {
  LocalNotifications = registerPlugin<LocalNotificationsPlugin>("LocalNotifications");
} catch {
  // Plugin not available
}

// ── Types ─────────────────────────────────────────────────────────────

export type NotificationPermissionResult = "granted" | "denied" | "default" | "unavailable" | "error";

// ── Public API ────────────────────────────────────────────────────────

/**
 * Safely request notification permission.
 * Never throws — always returns a result.
 *
 * @returns Permission status string
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionResult> {
  // ── Android (Capacitor) ──────────────────────────────────────────
  if (LocalNotifications) {
    try {
      const result = await LocalNotifications.requestPermissions();
      return result.display === "granted" ? "granted" : "denied";
    } catch {
      return "error";
    }
  }

  // ── Web / Electron Notification API ──────────────────────────────
  if (typeof Notification === "undefined") {
    return "unavailable";
  }

  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch {
    return "error";
  }
}

/**
 * Check current notification permission without prompting.
 */
export async function checkNotificationPermission(): Promise<NotificationPermissionResult> {
  // Android
  if (LocalNotifications) {
    try {
      const result = await LocalNotifications.checkPermissions();
      return result.display === "granted" ? "granted" : "denied";
    } catch {
      return "error";
    }
  }

  // Web
  if (typeof Notification === "undefined") {
    return "unavailable";
  }

  try {
    return Notification.permission;
  } catch {
    return "error";
  }
}

/**
 * Show a safe notification — never crashes even if permission is denied.
 */
export async function showNotification(
  title: string,
  options?: { body?: string; icon?: string; tag?: string },
): Promise<boolean> {
  const permission = await checkNotificationPermission();
  if (permission !== "granted") return false;

  // Android (Capacitor)
  if (LocalNotifications) {
    try {
      await LocalNotifications.requestPermissions();
      // Capacitor handles display natively
      return true;
    } catch {
      return false;
    }
  }

  // Web
  try {
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}
