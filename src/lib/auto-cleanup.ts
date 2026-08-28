/**
 * Auto Cleanup — removes orphan .tmp, .part, and .state files.
 *
 * Failed or cancelled downloads leave behind temporary files that waste
 * disk space. This module:
 *   1. Runs on app startup to clean stale temp files (> 24h old)
 *   2. Runs after each download completes to clean the current session's temps
 *   3. Provides a manual cleanup trigger
 *
 * Works on:
 *   - Android (via native plugin)
 *   - Desktop (Electron — direct filesystem access)
 *   - Browser (via localStorage-based tracking — limited)
 */

import { registerPlugin } from "@capacitor/core";

// ── Plugin Interface ──────────────────────────────────────────────────

interface CleanupPluginInterface {
  /**
   * Remove orphan temp files from the download directory.
   * @param maxAgeHours - Only delete files older than this (default: 24h)
   * @returns Number of files removed
   */
  cleanupTempFiles(options: {
    maxAgeHours?: number;
    subdirectory?: string;
  }): Promise<{ removed: number; freedBytes: number }>;

  /**
   * Get disk usage stats for the download directory.
   */
  getDiskUsage(options: {
    subdirectory?: string;
  }): Promise<{
    totalFiles: number;
    tempFiles: number;
    totalBytes: number;
    tempBytes: number;
  }>;
}

// ── Safe Plugin Registration ──────────────────────────────────────────

let CleanupPlugin: CleanupPluginInterface | undefined;
try {
  CleanupPlugin = registerPlugin<CleanupPluginInterface>("Cleanup");
} catch {
  // Plugin not available
}

// ── Desktop Bridge ────────────────────────────────────────────────────

interface DesktopBridge {
  isDesktop: boolean;
  cleanupTempFiles(options: {
    maxAgeHours?: number;
    directory?: string;
  }): Promise<{ removed: number; freedBytes: number }>;
}

const Desktop = (window as unknown as Record<string, unknown>)["vidfetch"] as
  | DesktopBridge
  | undefined;

// ── Browser-side tracking ─────────────────────────────────────────────

const TEMP_FILE_KEY = "vidfetch.tempFiles";
const CLEANUP_RUN_KEY = "vidfetch.lastCleanup";

/**
 * Track a temp file created during download.
 * Used for browser-side cleanup since we can't access the filesystem.
 */
export function trackTempFile(filename: string): void {
  try {
    const existing = JSON.parse(
      localStorage.getItem(TEMP_FILE_KEY) ?? "[]",
    ) as Array<{ name: string; created: number }>;
    existing.push({ name: filename, created: Date.now() });
    // Keep only last 100 entries
    const trimmed = existing.slice(-100);
    localStorage.setItem(TEMP_FILE_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage unavailable
  }
}

/**
 * Remove a temp file from tracking (called after successful download).
 */
export function untrackTempFile(filename: string): void {
  try {
    const existing = JSON.parse(
      localStorage.getItem(TEMP_FILE_KEY) ?? "[]",
    ) as Array<{ name: string; created: number }>;
    const filtered = existing.filter((f) => f.name !== filename);
    localStorage.setItem(TEMP_FILE_KEY, JSON.stringify(filtered));
  } catch {
    // Storage unavailable
  }
}

// ── Public API ────────────────────────────────────────────────────────

export interface CleanupResult {
  removed: number;
  freedBytes: number;
  method: "native" | "desktop" | "browser";
}

/**
 * Run cleanup of orphan temp files.
 *
 * @param maxAgeHours - Only delete files older than this (default: 24)
 * @returns Cleanup result with stats
 */
export async function runCleanup(maxAgeHours: number = 24): Promise<CleanupResult> {
  // ── Android (Capacitor) ──────────────────────────────────────────
  if (CleanupPlugin) {
    try {
      const result = await CleanupPlugin.cleanupTempFiles({
        maxAgeHours,
        subdirectory: "VidFetch",
      });
      return {
        removed: result.removed,
        freedBytes: result.freedBytes,
        method: "native",
      };
    } catch {
      // Fall through to browser cleanup
    }
  }

  // ── Desktop (Electron) ──────────────────────────────────────────
  if (Desktop?.isDesktop) {
    try {
      const result = await Desktop.cleanupTempFiles({ maxAgeHours });
      return {
        removed: result.removed,
        freedBytes: result.freedBytes,
        method: "desktop",
      };
    } catch {
      // Fall through to browser cleanup
    }
  }

  // ── Browser fallback — clear localStorage tracking ──────────────
  try {
    const existing = JSON.parse(
      localStorage.getItem(TEMP_FILE_KEY) ?? "[]",
    ) as Array<{ name: string; created: number }>;

    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
    const stale = existing.filter((f) => f.created < cutoff);
    const fresh = existing.filter((f) => f.created >= cutoff);

    localStorage.setItem(TEMP_FILE_KEY, JSON.stringify(fresh));

    return {
      removed: stale.length,
      freedBytes: 0, // Can't know actual size in browser
      method: "browser",
    };
  } catch {
    return { removed: 0, freedBytes: 0, method: "browser" };
  }
}

/**
 * Run cleanup on app startup.
 * Checks if cleanup was run in the last 6 hours; if not, runs it.
 */
export async function startupCleanup(): Promise<void> {
  try {
    const lastRun = parseInt(
      localStorage.getItem(CLEANUP_RUN_KEY) ?? "0",
      10,
    );
    const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;

    if (lastRun > sixHoursAgo) return; // Recently cleaned

    const result = await runCleanup(24);
    localStorage.setItem(CLEANUP_RUN_KEY, Date.now().toString());

    if (result.removed > 0) {
      console.log(
        `[auto-cleanup] Removed ${result.removed} temp files ` +
        `(${formatBytes(result.freedBytes)} freed) via ${result.method}`,
      );
    }
  } catch {
    // Non-critical — don't crash the app
  }
}

/**
 * Cleanup after a specific download completes or fails.
 * Removes any .tmp/.part files associated with the download.
 */
export async function postDownloadCleanup(filename?: string): Promise<void> {
  try {
    // Remove from browser tracking
    if (filename) {
      untrackTempFile(filename);
      untrackTempFile(`${filename}.part`);
      untrackTempFile(`${filename}.tmp`);
    }

    // Run native cleanup if available
    if (CleanupPlugin) {
      await CleanupPlugin.cleanupTempFiles({
        maxAgeHours: 0, // Clean ALL temps after download
        subdirectory: "VidFetch",
      });
    }
  } catch {
    // Non-critical
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let idx = 0;
  let size = bytes;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx++;
  }
  return `${size.toFixed(1)} ${units[idx]}`;
}
