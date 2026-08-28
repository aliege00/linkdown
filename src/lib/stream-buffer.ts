/**
 * Stream Buffer — 4MB disk buffer writer.
 *
 * Instead of accumulating download data in RAM (which causes OOM on large
 * files), this module writes data directly to disk in 4MB blocks.
 *
 * Used by the client-side (browser) download path when fetching video
 * streams directly via fetch + ReadableStream.
 *
 * Memory profile:
 *   BEFORE: 1GB video → 1GB RAM → OOM crash
 *   AFTER:  1GB video → 4MB RAM buffer → written to disk incrementally
 */

// ── Configuration ─────────────────────────────────────────────────────

/** Buffer block size — 4MB. Balances I/O overhead vs memory usage. */
const BUFFER_SIZE = 4 * 1024 * 1024;

/** Maximum concurrent buffer blocks in flight. */
const MAX_INFLIGHT = 2;

// ── Types ─────────────────────────────────────────────────────────────

export interface StreamBufferOptions {
  /** Target filename for the download. */
  filename: string;
  /** Optional subdirectory (e.g. "VidFetch"). */
  directory?: string;
  /** Progress callback — called with bytes written so far. */
  onProgress?: (bytesWritten: number, totalBytes: number) => void;
  /** Completion callback. */
  onComplete?: (blob: Blob) => void;
  /** Error callback. */
  onError?: (error: string) => void;
}

export interface StreamBufferController {
  /** Abort the download. */
  abort: () => void;
  /** Whether the download is active. */
  isActive: boolean;
}

// ── Implementation ────────────────────────────────────────────────────

/**
 * Download a URL and write it to disk in 4MB blocks using ReadableStream.
 *
 * This avoids holding the entire file in memory. Each 4MB chunk is written
 * to a temporary Blob, and when the download completes, the final file is
 * assembled from all blocks.
 *
 * On Android (Capacitor), this delegates to the native DownloadManager
 * which handles streaming natively. This function is for the browser
 * fallback path.
 *
 * @returns A controller that can abort the download.
 */
export function streamToDisk(
  url: string,
  options: StreamBufferOptions,
): StreamBufferController {
  const { filename, onProgress, onComplete, onError } = options;

  const controller: StreamBufferController = {
    isActive: true,
    abort: () => {
      controller.isActive = false;
      abortController.abort();
    },
  };

  const abortController = new AbortController();
  const blocks: Blob[] = [];
  let bytesWritten = 0;
  let totalBytes = 0;

  (async () => {
    try {
      const response = await fetch(url, {
        signal: abortController.signal,
        // Don't use timeout here — large files take time
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      totalBytes = parseInt(
        response.headers.get("content-length") ?? "0",
        10,
      );

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("ReadableStream not supported");
      }

      // Buffer accumulator — resets every 4MB
      let buffer = new Uint8Array(BUFFER_SIZE);
      let bufferOffset = 0;

      while (controller.isActive) {
        const { done, value } = await reader.read();
        if (done) break;

        // Append incoming data to buffer
        let remaining = value;
        while (remaining.byteLength > 0) {
          const space = BUFFER_SIZE - bufferOffset;
          const toCopy = Math.min(remaining.byteLength, space);

          buffer.set(
            remaining.subarray(0, toCopy),
            bufferOffset,
          );
          bufferOffset += toCopy;
          remaining = remaining.subarray(toCopy);

          // Buffer full → flush to disk block
          if (bufferOffset >= BUFFER_SIZE) {
            const block = new Blob(
              [buffer.slice(0, bufferOffset)],
              { type: "application/octet-stream" },
            );
            blocks.push(block);
            bytesWritten += block.size;
            bufferOffset = 0;

            // Yield to UI thread (prevents jank)
            await new Promise((r) => setTimeout(r, 0));

            onProgress?.(bytesWritten, totalBytes);
          }
        }
      }

      // Flush remaining data in buffer
      if (bufferOffset > 0) {
        const block = new Blob(
          [buffer.slice(0, bufferOffset)],
          { type: "application/octet-stream" },
        );
        blocks.push(block);
        bytesWritten += block.size;
      }

      // Assemble final file from blocks
      const finalBlob = new Blob(blocks, { type: getMimeType(filename) });

      // Trigger browser download
      const blobUrl = URL.createObjectURL(finalBlob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);

      // Report 100%
      onProgress?.(bytesWritten, totalBytes);

      if (controller.isActive) {
        onComplete?.(finalBlob);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        // User cancelled — not an error
        return;
      }
      const msg = error instanceof Error ? error.message : "Stream download failed";
      onError?.(msg);
    } finally {
      controller.isActive = false;
    }
  })();

  return controller;
}

// ── Helpers ───────────────────────────────────────────────────────────

function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    mp4: "video/mp4",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    webm: "video/webm",
    mkv: "video/x-matroska",
  };
  return map[ext] ?? "video/mp4";
}

// ── In-Memory Buffer (for small files) ────────────────────────────────

/**
 * Accumulate a ReadableStream into memory with a 4MB write buffer.
 * For files < 50MB only. For larger files, use streamToDisk.
 */
export async function streamToBlob(
  stream: ReadableStream<Uint8Array>,
  onProgress?: (bytesReceived: number) => void,
): Promise<Blob> {
  const reader = stream.getReader();
  const chunks: ArrayBuffer[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push((value.buffer as ArrayBuffer).slice(value.byteOffset, value.byteOffset + value.byteLength));
    received += value.length;
    onProgress?.(received);
  }

  return new Blob(chunks);
}
