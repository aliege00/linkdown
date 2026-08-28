/**
 * useClipboardMonitor — React hook for system clipboard URL detection.
 *
 * Periodically checks the system clipboard for video URLs (YouTube, TikTok,
 * Instagram, Twitter/X, Vimeo, etc.) and fires a callback when a new URL
 * is detected.
 *
 * On Android (Capacitor), uses the native Clipboard plugin.
 * On desktop (Electron), uses the preload bridge.
 * On web, uses the Clipboard API (readText) — requires permission.
 *
 * Features:
 *   - Deduplication: won't re-alert for the same URL within cooldown
 *   - URL validation: only triggers for recognized video site patterns
 *   - Configurable polling interval
 *   - Cleanup on unmount
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { isVideoUrl } from "@/lib/url";

// ── Capacitor Clipboard Plugin ──────────────────────────────────────────────

interface ClipboardPlugin {
  read(): Promise<{ value: string }>;
}

let CapacitorClipboard: ClipboardPlugin | undefined;
try {
  const cap = (window as unknown as Record<string, unknown>)["Capacitor"] as Record<string, unknown> | undefined;
  const plugins = cap?.["Plugins"] as Record<string, unknown> | undefined;
  if (plugins && typeof plugins["Clipboard"] === "object" && plugins["Clipboard"] !== null) {
    CapacitorClipboard = plugins["Clipboard"] as ClipboardPlugin;
  }
} catch {
  // Not in Capacitor
}

// ── Desktop Bridge ──────────────────────────────────────────────────────────

interface DesktopBridge {
  isDesktop: boolean;
  readClipboard(): Promise<string>;
}

const Desktop = (window as unknown as Record<string, unknown>)["vidfetch"] as DesktopBridge | undefined;

// ── Types ───────────────────────────────────────────────────────────────────

export interface ClipboardUrl {
  /** The detected URL. */
  url: string;
  /** Timestamp when detected. */
  detectedAt: number;
  /** Shortened display of the URL. */
  displayUrl: string;
}

export interface UseClipboardMonitorOptions {
  /** Enable/disable monitoring (default: true). */
  enabled?: boolean;
  /** Polling interval in ms (default: 2000). */
  interval?: number;
  /** Cooldown in ms before re-alerting for the same URL (default: 30000). */
  cooldown?: number;
  /** Callback when a new video URL is detected. */
  onUrlDetected?: (url: ClipboardUrl) => void;
}

export interface UseClipboardMonitorResult {
  /** The most recently detected URL, or null. */
  lastUrl: ClipboardUrl | null;
  /** Whether monitoring is active. */
  isMonitoring: boolean;
  /** Manually check clipboard once. */
  checkNow: () => Promise<void>;
  /** Clear the last detected URL. */
  clearLastUrl: () => void;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useClipboardMonitor(
  options: UseClipboardMonitorOptions = {},
): UseClipboardMonitorResult {
  const {
    enabled = true,
    interval = 2000,
    cooldown = 30_000,
    onUrlDetected,
  } = options;

  const [lastUrl, setLastUrl] = useState<ClipboardUrl | null>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const lastSeenRef = useRef<Map<string, number>>(new Map());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Read clipboard text from the appropriate platform
  const readClipboardText = useCallback(async (): Promise<string | null> => {
    try {
      // Desktop (Electron)
      if (Desktop?.isDesktop) {
        return await Desktop.readClipboard();
      }

      // Android (Capacitor)
      if (CapacitorClipboard) {
        const result = await CapacitorClipboard.read();
        return result.value;
      }

      // Web (Clipboard API — requires permission)
      if (navigator.clipboard?.readText) {
        return await navigator.clipboard.readText();
      }
    } catch {
      // Permission denied, API unavailable, etc.
    }
    return null;
  }, []);

  // Check clipboard for new video URLs
  const checkClipboard = useCallback(async () => {
    const text = await readClipboardText();
    if (!text) return;

    // Check if it's a video URL
    const trimmed = text.trim();
    if (!isVideoUrl(trimmed)) return;

    // Deduplication check
    const now = Date.now();
    const lastSeen = lastSeenRef.current.get(trimmed) ?? 0;
    if (now - lastSeen < cooldown) return;

    // New URL detected!
    lastSeenRef.current.set(trimmed, now);

    const displayUrl = trimmed.length > 60
      ? trimmed.substring(0, 57) + "..."
      : trimmed;

    const urlObj: ClipboardUrl = {
      url: trimmed,
      detectedAt: now,
      displayUrl,
    };

    setLastUrl(urlObj);
    onUrlDetected?.(urlObj);
  }, [readClipboardText, cooldown, onUrlDetected]);

  // Manual check
  const checkNow = useCallback(async () => {
    await checkClipboard();
  }, [checkClipboard]);

  // Clear
  const clearLastUrl = useCallback(() => {
    setLastUrl(null);
  }, []);

  // Start/stop polling
  useEffect(() => {
    if (!enabled) {
      setIsMonitoring(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    setIsMonitoring(true);

    // Initial check
    checkClipboard();

    // Start polling
    intervalRef.current = setInterval(checkClipboard, interval);

    return () => {
      setIsMonitoring(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, interval, checkClipboard]);

  // Cleanup old entries from dedup map (every 5 minutes)
  useEffect(() => {
    const cleanup = setInterval(() => {
      const now = Date.now();
      for (const [url, timestamp] of lastSeenRef.current.entries()) {
        if (now - timestamp > cooldown * 2) {
          lastSeenRef.current.delete(url);
        }
      }
    }, 300_000);
    return () => clearInterval(cleanup);
  }, [cooldown]);

  return { lastUrl, isMonitoring, checkNow, clearLastUrl };
}
