/**
 * Gallery Save — save downloaded videos to the device's public gallery.
 *
 * On Android 11+ (API 30+), this uses MediaStore via the native Capacitor
 * plugin so the video appears in the Gallery / Photos app immediately.
 * No runtime permissions are needed for MediaStore writes on Android 10+.
 *
 * On older Android or web/desktop, this is a no-op that returns gracefully.
 *
 * Edge-case handling:
 *   - Disk-full detection with Turkish error message
 *   - File-not-found detection
 *   - Permission denied guidance
 *   - Generic network / I/O error fallbacks
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

// Defensive: if registerPlugin returns something that doesn't have our
// expected methods, treat it as unavailable instead of crashing later.
if (MediaStore && typeof MediaStore.saveToGallery !== "function") {
  MediaStore = undefined;
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

/**
 * Classify a native error into a user-friendly Turkish + English message.
 */
function classifyGalleryError(
  nativeError: string,
): { message: string; messageTr: string; code: string } {
  const err = nativeError.toLowerCase();

  if (
    err.includes("disk full") ||
    err.includes("no space") ||
    err.includes("yetersiz") ||
    err.includes("depolama alanı dolu")
  ) {
    return {
      message: "Not enough storage space. Free up space and try again.",
      messageTr: "Depolama alanı yetersiz. Yer açıp tekrar deneyin.",
      code: "DISK_FULL",
    };
  }

  if (err.includes("file not found") || err.includes("bulunamadı")) {
    return {
      message: "Downloaded file not found — it may have been deleted or moved.",
      messageTr: "İndirilen dosya bulunamadı — silinmiş veya taşınmış olabilir.",
      code: "FILE_NOT_FOUND",
    };
  }

  if (err.includes("permission denied") || err.includes("izin")) {
    return {
      message: "Storage permission denied. Grant it in Settings → Apps → VidFetch → Permissions.",
      messageTr:
        "Depolama izni reddedildi. Ayarlar → Uygulamalar → VidFetch → İzinler bölümünden izin verin.",
      code: "PERMISSION_DENIED",
    };
  }

  if (err.includes("empty") || err.includes("0 byte") || err.includes("boş")) {
    return {
      message: "The downloaded file is empty — the download may have failed.",
      messageTr: "İndirilen dosya boş — indirme başarısız olmuş olabilir.",
      code: "FILE_EMPTY",
    };
  }

  if (err.includes("not available") || err.includes("bulunamıyor")) {
    return {
      message: "Gallery save is not available on this device.",
      messageTr: "Bu cihazda galeriye kaydetme özelliği kullanılamıyor.",
      code: "NOT_AVAILABLE",
    };
  }

  // Fallback
  return {
    message: nativeError || "Failed to save to gallery",
    messageTr: "Galeriye kaydetme başarısız",
    code: "UNKNOWN",
  };
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
  /** Turkish error message when success is false. */
  errorTr?: string;
  /** Programmatic error code. */
  errorCode?: string;
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
 * } else {
 *   console.error(result.errorTr);
 * }
 * ```
 */
export async function saveToGallery(
  options: GallerySaveOptions,
): Promise<GallerySaveResult> {
  const { filePath, displayName, mimeType } = options;

  if (!filePath) {
    return {
      success: false,
      error: "filePath is required",
      errorTr: "Dosya yolu gerekli",
      errorCode: "INVALID_ARGS",
    };
  }

  if (!isNativeEnv()) {
    return {
      success: false,
      error: "Gallery save is only available in the Android APK or Windows EXE.",
      errorTr: "Galeriye kaydetme yalnızca Android APK veya Windows EXE'de çalışır.",
      errorCode: "NOT_NATIVE",
    };
  }

  const resolvedMime = mimeType ?? extToMime(filePath);
  const resolvedName =
    displayName ?? filePath.split("/").pop() ?? "video.mp4";

  // Desktop (Electron) path
  if (Desktop?.isDesktop) {
    try {
      const result = await Desktop.saveToGallery({
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
      const msg = error instanceof Error ? error.message : "Desktop save failed";
      const classified = classifyGalleryError(msg);
      return {
        success: false,
        error: classified.message,
        errorTr: classified.messageTr,
        errorCode: classified.code,
      };
    }
  }

  // Android (Capacitor) path
  if (!MediaStore) {
    return {
      success: false,
      error: "MediaStore plugin not available",
      errorTr: "MediaStore eklentisi kullanılamıyor",
      errorCode: "PLUGIN_MISSING",
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
    const msg =
      error instanceof Error ? error.message : "Failed to save to gallery";
    const classified = classifyGalleryError(msg);
    return {
      success: false,
      error: classified.message,
      errorTr: classified.messageTr,
      errorCode: classified.code,
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
