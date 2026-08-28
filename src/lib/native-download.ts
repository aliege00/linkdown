/**
 * Native DownloadManager — Android's built-in download service.
 *
 * When the user has a direct stream URL (extracted by the on-device engine),
 * this module passes it to Android's native DownloadManager for efficient,
 * background-capable downloading without any server.
 *
 * Key benefits over yt-dlp-based downloads:
 *   - System-managed (survives app kills, handles connectivity changes)
 *   - Progress notifications handled by the OS
 *   - Pause/resume built-in
 *   - Battery-efficient
 *
 * Falls back gracefully on desktop (EXE) and web environments.
 */

import { registerPlugin } from "@capacitor/core";

// ── Plugin Interface ──────────────────────────────────────────────────

interface NativeDownloadPluginInterface {
  /**
   * Download a file via Android's DownloadManager.
   * Returns immediately with a download ID for tracking.
   */
  download(options: {
    url: string;
    title: string;
    description?: string;
    mimeType?: string;
    fileName?: string;
    /** Subdirectory inside Downloads (default: "VidFetch") */
    subdirectory?: string;
  }): Promise<{ downloadId: number }>;

  /**
   * Check the status of a download.
   */
  getStatus(options: { downloadId: number }): Promise<{
    status: "running" | "paused" | "completed" | "failed" | "pending";
    bytesDownloaded: number;
    totalBytes: number;
    failureReason?: string;
  }>;

  /**
   * Pause an active download.
   */
  pause(options: { downloadId: number }): Promise<void>;

  /**
   * Resume a paused download.
   */
  resume(options: { downloadId: number }): Promise<void>;

  /**
   * Cancel a download and remove partially downloaded files.
   */
  cancel(options: { downloadId: number }): Promise<void>;

  /**
   * Open a downloaded file with the system's default viewer.
   */
  openFile(options: { downloadId: number }): Promise<{ success: boolean; path?: string }>;

  /**
   * List all completed downloads from VidFetch.
   */
  listDownloads(): Promise<{
    downloads: Array<{
      downloadId: number;
      fileName: string;
      path: string;
      size: number;
      date: number;
      mimeType: string;
    }>;
  }>;
}

// ── Safe Plugin Registration ──────────────────────────────────────────

let NativeDownload: NativeDownloadPluginInterface | undefined;
try {
  NativeDownload = registerPlugin<NativeDownloadPluginInterface>("NativeDownload");
} catch {
  // Plugin not available in this environment
}

// ── Desktop Bridge ────────────────────────────────────────────────────

interface DesktopBridge {
  isDesktop: boolean;
  downloadFile(options: {
    url: string;
    fileName: string;
    directory?: string;
  }): Promise<{ success: boolean; filePath?: string }>;
}

const Desktop = (window as unknown as Record<string, unknown>)["vidfetch"] as
  | DesktopBridge
  | undefined;

// ── Environment Detection ─────────────────────────────────────────────

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

// ── Public API ────────────────────────────────────────────────────────

export interface NativeDownloadOptions {
  url: string;
  title: string;
  description?: string;
  mimeType?: string;
  fileName?: string;
  subdirectory?: string;
}

export interface NativeDownloadStatus {
  downloadId: number;
  status: "running" | "paused" | "completed" | "failed" | "pending" | "unknown";
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  failureReason?: string;
}

export interface NativeDownloadResult {
  success: boolean;
  downloadId?: number;
  filePath?: string;
  error?: string;
  errorTr?: string;
  /** Whether this was handled by the native DownloadManager */
  usedNativeManager: boolean;
}

/**
 * Download a file using the most appropriate native mechanism:
 *   - Android: DownloadManager (system-managed, background-capable)
 *   - Desktop: Electron's shell.openExternal or direct download
 *   - Web: browser fetch + blob (limited, no background)
 */
export async function nativeDownload(
  options: NativeDownloadOptions,
): Promise<NativeDownloadResult> {
  const { url, title, description, mimeType, fileName, subdirectory } = options;

  if (!url) {
    return {
      success: false,
      error: "No URL provided",
      errorTr: "URL belirtilmedi",
      usedNativeManager: false,
    };
  }

  // ── Android (Capacitor) path ──────────────────────────────────────
  if (NativeDownload && isNativeEnv() && !Desktop?.isDesktop) {
    try {
      const result = await NativeDownload.download({
        url,
        title,
        description: description || `Downloading ${title}`,
        mimeType: mimeType || "video/mp4",
        fileName,
        subdirectory: subdirectory || "VidFetch",
      });
      return {
        success: true,
        downloadId: result.downloadId,
        usedNativeManager: true,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Native download failed";
      return {
        success: false,
        error: msg,
        errorTr: classifyNativeError(msg),
        usedNativeManager: true,
      };
    }
  }

  // ── Desktop (Electron) path ───────────────────────────────────────
  if (Desktop?.isDesktop) {
    try {
      const result = await Desktop.downloadFile({
        url,
        fileName: fileName || title || "download",
      });
      return {
        success: result.success,
        filePath: result.filePath,
        usedNativeManager: false,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Desktop download failed";
      return {
        success: false,
        error: msg,
        errorTr: classifyNativeError(msg),
        usedNativeManager: false,
      };
    }
  }

  // ── Web fallback ──────────────────────────────────────────────────
  // Trigger browser download (works for direct URLs)
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return { success: true, usedNativeManager: false };
  } catch {
    return {
      success: false,
      error: "Browser download failed",
      errorTr: "Tarayıcı indirme başarısız",
      usedNativeManager: false,
    };
  }
}

/**
 * Check the status of an active download (Android only).
 */
export async function getDownloadStatus(
  downloadId: number,
): Promise<NativeDownloadStatus> {
  if (!NativeDownload) {
    return {
      downloadId,
      status: "unknown",
      bytesDownloaded: 0,
      totalBytes: 0,
      percent: 0,
    };
  }

  try {
    const result = await NativeDownload.getStatus({ downloadId });
    return {
      downloadId,
      status: result.status,
      bytesDownloaded: result.bytesDownloaded,
      totalBytes: result.totalBytes,
      percent: result.totalBytes > 0
        ? Math.round((result.bytesDownloaded / result.totalBytes) * 100)
        : 0,
      failureReason: result.failureReason,
    };
  } catch {
    return {
      downloadId,
      status: "unknown",
      bytesDownloaded: 0,
      totalBytes: 0,
      percent: 0,
    };
  }
}

/**
 * Pause an active download (Android only).
 */
export async function pauseDownload(downloadId: number): Promise<void> {
  if (!NativeDownload) return;
  try {
    await NativeDownload.pause({ downloadId });
  } catch {
    // Non-critical
  }
}

/**
 * Resume a paused download (Android only).
 */
export async function resumeDownload(downloadId: number): Promise<void> {
  if (!NativeDownload) return;
  try {
    await NativeDownload.resume({ downloadId });
  } catch {
    // Non-critical
  }
}

/**
 * Cancel an active download (Android only).
 */
export async function cancelNativeDownload(downloadId: number): Promise<void> {
  if (!NativeDownload) return;
  try {
    await NativeDownload.cancel({ downloadId });
  } catch {
    // Non-critical
  }
}

// ── Error Classification ──────────────────────────────────────────────

function classifyNativeError(msg: string): string {
  const lower = msg.toLowerCase();

  if (lower.includes("network") || lower.includes("econnrefused") || lower.includes("timeout")) {
    return "Ağ bağlantısı kesildi — lütfen tekrar deneyin";
  }
  if (lower.includes("disk full") || lower.includes("no space") || lower.includes("enospc")) {
    return "Depolama alanı yetersiz — yer açıp tekrar deneyin";
  }
  if (lower.includes("permission") || lower.includes("izin")) {
    return "Depolama izni gerekli — Ayarlar'dan izin verin";
  }
  if (lower.includes("403") || lower.includes("forbidden")) {
    return "Erişim engellendi — video kaldırılmış veya kısıtlı olabilir";
  }
  if (lower.includes("404") || lower.includes("not found")) {
    return "Dosya bulunamadı — bağlantı geçerli olmayabilir";
  }

  return "İndirme başarısız — lütfen tekrar deneyin";
}
