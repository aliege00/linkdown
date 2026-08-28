/**
 * Gallery Save — save downloaded videos to the device's public gallery.
 *
 * On Android 11+ (API 30+), this uses MediaStore via the native Capacitor
 * plugin so the video appears in the Gallery / Photos app immediately.
 * No runtime permissions are needed for MediaStore writes on Android 10+.
 *
 * On older Android or web/desktop, this is a no-op that returns gracefully.
 */

import { registerPlugin } from "@capacitor/core";

// ── Plugin interface ────────────────────────────────────────────────────────

interface MediaStorePluginInterface {
  saveToGallery(options: {
    filePath: string;
    displayName?: string;
    mimeType?: string;
  }): Promise<SaveResult>;

  checkPermission(): Promise<{
    granted: boolean;
    apiLevel: number;
    needsPermission: boolean;
  }>;

  openInGallery(options: { mediaUri: string }): Promise<{ success: boolean }>;
}

interface SaveResult {
  success: boolean;
  mediaUri?: string;
  displayName?: string;
}

// ── Capacitor plugin registration ───────────────────────────────────────────

let MediaStore: MediaStorePluginInterface | undefined;

try {
  MediaStore = registerPlugin<MediaStorePluginInterface>("MediaStore");
} catch {
  // Not in a Capacitor environment — plugin won't be available
}

// ── Desktop bridge (Electron) ───────────────────────────────────────────────

interface DesktopBridge {
  isDesktop: boolean;
  saveToGallery(options: {
    filePath: string;
    displayName?: string;
    mimeType?: string;
  }): Promise<SaveResult>;
}

const Desktop = (window as unknown as Record<string, unknown>)[
  "vidfetch"
] as DesktopBridge | undefined;

// ── Helpers ─────────────────────────────────────────────────────────────────

function isNativeEnv(): boolean {
  if (Desktop?.isDesktop) return true;
  try {
    const cap = (window as unknown as Record<string, unknown>)["Capacitor"] as
      | { isNativePlatform?: () => boolean }
      | undefined;
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
}

function extToMime(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    mp4: "video/mp4",
    mkv: "video/x-matroska",
    webm: "video/webm",
    avi: "video/x-msvideo",
    mov: "video/quicktime",
    flv: "video/x-flv",
    "3gp": "video/3gpp",
    ts: "video/mp2t",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    wav: "audio/wav",
   opus: "audio/opus",
  };
  return map[ext] ?? "video/mp4";
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface GallerySaveOptions {
  /** Absolute path to the downloaded file on the device. */
  filePath: string;
  /** Desired filename in the gallery (defaults to the file's basename). */
  displayName?: string;
  /** MIME type (auto-detected from extension if omitted). */
  mimeType?: string;
}

export interface GallerySaveResult {
  success: boolean;
  /** MediaStore content URI (Android) — can be used to open or delete later. */
  mediaUri?: string;
  /** The final display name (may differ if a duplicate was renamed). */
  displayName?: string;
  /** Error message when success is false. */
  error?: string;
}

/**
 * Save a downloaded video file to the device's public gallery / Downloads.
 *
 * - Android 10+ (API 29+): Uses MediaStore API — no permissions needed.
 * - Android 9 and below: Uses WRITE_EXTERNAL_STORAGE.
 * - Desktop / Web: No-op (returns success: false with a reason).
 *
 * @example
 * ```ts
 * const result = await saveToGallery({
 *   filePath: "/data/.../video.mp4",
 *   displayName: "Rick Astley - Never Gonna Give You Up.mp4",
 * });
 * if (result.success) {
 *   console.log("Saved to gallery:", result.mediaUri);
 * }
 * ```
 */
export async function saveToGallery(
  options: GallerySaveOptions,
): Promise<GallerySaveResult> {
  const { filePath, displayName, mimeType } = options;

  if (!filePath) {
    return { success: false, error: "filePath is required" };
  }

  if (!isNativeEnv()) {
    return {
      success: false,
      error: "Gallery save is only available in the Android APK or Windows EXE.",
    };
  }

  const resolvedMime = mimeType ?? extToMime(filePath);
  const resolvedName = displayName ?? filePath.split("/").pop() ?? "video.mp4";

  // Desktop (Electron) path
  if (Desktop?.isDesktop) {
    try {
      return await Desktop.saveToGallery({
        filePath,
        displayName: resolvedName,
        mimeType: resolvedMime,
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Desktop save failed",
      };
    }
  }

  // Android (Capacitor) path
  if (!MediaStore) {
    return {
      success: false,
      error: "MediaStore plugin not available",
    };
  }

  try {
    const result = await MediaStore.saveToGallery({
      filePath,
      displayName: resolvedName,
      mimeType: resolvedMime,
    });
    return {
      success: result.success,
      mediaUri: result.mediaUri,
      displayName: result.displayName,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to save to gallery",
    };
  }
}

/**
 * Check if gallery save is supported and what permissions are needed.
 */
export async function checkGalleryPermission(): Promise<{
  supported: boolean;
  granted: boolean;
  apiLevel: number;
  needsPermission: boolean;
}> {
  if (!isNativeEnv()) {
    return {
      supported: false,
      granted: false,
      apiLevel: 0,
      needsPermission: false,
    };
  }

  if (Desktop?.isDesktop) {
    return {
      supported: true,
      granted: true,
      apiLevel: 0,
      needsPermission: false,
    };
  }

  if (!MediaStore) {
    return {
      supported: false,
      granted: false,
      apiLevel: 0,
      needsPermission: false,
    };
  }

  try {
    const result = await MediaStore.checkPermission();
    return {
      supported: true,
      granted: result.granted,
      apiLevel: result.apiLevel,
      needsPermission: result.needsPermission,
    };
  } catch {
    return {
      supported: false,
      granted: false,
      apiLevel: 0,
      needsPermission: false,
    };
  }
}

/**
 * Open a saved video in the device's default gallery / video player.
 */
export async function openInGallery(mediaUri: string): Promise<boolean> {
  if (!isNativeEnv()) return false;

  if (Desktop?.isDesktop) {
    try {
      const res = await Desktop.saveToGallery({
        filePath: mediaUri,
        displayName: "open",
      });
      return res.success;
    } catch {
      return false;
    }
  }

  if (!MediaStore) return false;

  try {
    const res = await MediaStore.openInGallery({ mediaUri });
    return res.success;
  } catch {
    return false;
  }
}
