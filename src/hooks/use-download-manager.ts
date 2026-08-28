/**
 * useDownloadManager — Unified download orchestrator for the frontend.
 *
 * Wraps the chunked download server endpoints with:
 *   - Start / pause / resume / cancel
 *   - Real-time progress tracking via polling
 *   - Resume detection (checks for existing .part files)
 *   - Error classification with bilingual messages
 */

import { useCallback, useRef, useState } from "react";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DownloadProgress {
  downloaded: number;
  total: number;
  speed_bps: number;
  eta: string;
  percent: number;
  chunks_completed: number;
  chunks_total: number;
}

export interface DownloadTask {
  id: string;
  url: string;
  outputPath: string;
  filename: string;
  status: "idle" | "probing" | "downloading" | "paused" | "completed" | "error";
  progress: DownloadProgress | null;
  error: string | null;
  errorTr: string | null;
  supportsRange: boolean;
  startedAt: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getServerUrl(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (import.meta as any).env.VITE_YTDLP_SERVER_URL || "";
}

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

function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

function classifyError(msg: string): { message: string; messageTr: string } {
  const lower = msg.toLowerCase();

  if (lower.includes("network") || lower.includes("econnrefused") || lower.includes("timeout")) {
    return {
      message: "Network error — check your connection",
      messageTr: "Ağ hatası — bağlantınızı kontrol edin",
    };
  }
  if (lower.includes("disk full") || lower.includes("no space") || lower.includes("enospc")) {
    return {
      message: "Not enough disk space",
      messageTr: "Depolama alanı yetersiz",
    };
  }
  if (lower.includes("403") || lower.includes("forbidden")) {
    return {
      message: "Access denied by the server",
      messageTr: "Sunucu tarafından erişim engellendi",
    };
  }
  if (lower.includes("404") || lower.includes("not found")) {
    return {
      message: "File not found on the server",
      messageTr: "Dosya sunucuda bulunamadı",
    };
  }

  return { message: msg, messageTr: msg };
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useDownloadManager() {
  const [task, setTask] = useState<DownloadTask | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Probe a URL to check if it supports Range requests.
   */
  const probe = useCallback(async (url: string) => {
    const server = getServerUrl();
    if (!server) return { supports_range: false, content_length: 0, filename: "" };

    const resp = await fetch(
      `${server}/api/chunked/probe?url=${encodeURIComponent(url)}`,
    );
    const data = await resp.json();
    return data;
  }, []);

  /**
   * Start a chunked download.
   */
  const startDownload = useCallback(
    async (url: string, filename?: string) => {
      const server = getServerUrl();
      if (!server) {
        setTask({
          id: "",
          url,
          outputPath: "",
          filename: filename || "download",
          status: "error",
          progress: null,
          error: "No download server configured",
          errorTr: "İndirme sunucusu yapılandırılmamış",
          supportsRange: false,
          startedAt: Date.now(),
        });
        return;
      }

      // Probe first
      setTask((prev) => ({
        ...(prev || {
          id: "",
          url,
          outputPath: "",
          filename: filename || "download",
          status: "idle",
          progress: null,
          error: null,
          errorTr: null,
          supportsRange: false,
          startedAt: Date.now(),
        }),
        status: "probing",
      }));

      try {
        const probeResult = await probe(url);
        const outputName = filename || probeResult.filename || "download";

        // Start chunked download
        const resp = await fetch(
          `${server}/api/chunked/download?url=${encodeURIComponent(url)}&output_name=${encodeURIComponent(outputName)}&threads=8`,
        );
        const data = await resp.json();

        if (!data.success) {
          const classified = classifyError(data.error || "Failed to start download");
          setTask({
            id: "",
            url,
            outputPath: "",
            filename: outputName,
            status: "error",
            progress: null,
            error: classified.message,
            errorTr: classified.messageTr,
            supportsRange: false,
            startedAt: Date.now(),
          });
          return;
        }

        setTask({
          id: data.download_id,
          url,
          outputPath: data.output_path,
          filename: outputName,
          status: "downloading",
          progress: null,
          error: null,
          errorTr: null,
          supportsRange: probeResult.supports_range,
          startedAt: Date.now(),
        });

        // Start progress polling
        startProgressPolling(data.download_id);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        const classified = classifyError(msg);
        setTask((prev) =>
          prev
            ? { ...prev, status: "error", error: classified.message, errorTr: classified.messageTr }
            : null,
        );
      }
    },
    [probe],
  );

  /**
   * Start polling for download progress.
   */
  const startProgressPolling = useCallback((downloadId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      const server = getServerUrl();
      if (!server) return;

      try {
        const resp = await fetch(`${server}/api/chunked/progress/${downloadId}`);
        const data = await resp.json();

        if (data.finished) {
          setTask((prev) =>
            prev ? { ...prev, status: "completed" } : null,
          );
          stopPolling();
          return;
        }

        if (data.failed) {
          const classified = classifyError(data.error || "Download failed");
          setTask((prev) =>
            prev
              ? { ...prev, status: "error", error: classified.message, errorTr: classified.messageTr }
              : null,
          );
          stopPolling();
          return;
        }

        if (data.percent !== undefined) {
          setTask((prev) =>
            prev
              ? {
                  ...prev,
                  progress: {
                    downloaded: data.downloaded || 0,
                    total: data.total || 0,
                    speed_bps: data.speed_bps || 0,
                    eta: data.eta || "--:--",
                    percent: data.percent || 0,
                    chunks_completed: data.chunks_completed || 0,
                    chunks_total: data.chunks_total || 0,
                  },
                }
              : null,
          );
        }
      } catch {
        // Polling error — don't crash, just skip this tick
      }
    }, 500); // Poll every 500ms for smooth progress
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /**
   * Pause the current download.
   */
  const pause = useCallback(async () => {
    if (!task?.id) return;
    const server = getServerUrl();
    if (!server) return;

    stopPolling();
    await fetch(`${server}/api/chunked/pause/${task.id}`, { method: "POST" });
    setTask((prev) => (prev ? { ...prev, status: "paused" } : null));
  }, [task?.id, stopPolling]);

  /**
   * Resume a paused download.
   */
  const resume = useCallback(async () => {
    if (!task?.id) return;
    const server = getServerUrl();
    if (!server) return;

    await fetch(`${server}/api/chunked/resume/${task.id}`, { method: "POST" });
    setTask((prev) => (prev ? { ...prev, status: "downloading" } : null));
    startProgressPolling(task.id);
  }, [task?.id, startProgressPolling]);

  /**
   * Cancel the current download.
   */
  const cancel = useCallback(async () => {
    if (!task?.id) return;
    const server = getServerUrl();
    if (!server) return;

    stopPolling();
    await fetch(`${server}/api/chunked/cancel/${task.id}`, { method: "POST" });
    setTask(null);
  }, [task?.id, stopPolling]);

  /**
   * Format progress for display.
   */
  const formattedProgress = task?.progress
    ? {
        percent: task.progress.percent.toFixed(1),
        downloaded: formatBytes(task.progress.downloaded),
        total: formatBytes(task.progress.total),
        speed: formatSpeed(task.progress.speed_bps),
        eta: task.progress.eta,
        chunks: `${task.progress.chunks_completed}/${task.progress.chunks_total}`,
      }
    : null;

  return {
    task,
    formattedProgress,
    startDownload,
    pause,
    resume,
    cancel,
    probe,
  };
}
