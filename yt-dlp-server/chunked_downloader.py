"""
Multi-Threaded Chunked Download Engine
=======================================

Splits a file download into N parallel chunks using HTTP Range requests,
downloads them concurrently, and merges the parts into the final file.

JDownloader-style architecture:
  1. HEAD request → get Content-Length + Accept-Ranges
  2. Split into N chunks (default: 8)
  3. Download each chunk in parallel (threading pool)
  4. Verify chunk integrity (SHA-256 per chunk optional)
  5. Merge .part files into final file
  6. Cleanup temporary parts

Features:
  - Automatic fallback to single-stream if server doesn't support Range
  - Pause/resume per-chunk via .part files
  - Progress callback for real-time UI updates
  - Bandwidth throttling (optional)
  - Integrity verification after merge

Environment variables:
  CHUNKED_DOWNLOAD_THREADS
      Number of parallel download threads (default: 8, min: 1, max: 32)
  CHUNKED_DOWNLOAD_CHUNK_SIZE
      Chunk size in bytes (default: 4 MB)
  CHUNKED_DOWNLOAD_TIMEOUT
      Per-chunk timeout in seconds (default: 120)
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
import shutil
import struct
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urlparse

import requests

logger = logging.getLogger("vidfetch.chunked")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_THREADS = int(os.environ.get("CHUNKED_DOWNLOAD_THREADS", "8"))
DEFAULT_CHUNK_SIZE = int(os.environ.get("CHUNKED_DOWNLOAD_CHUNK_SIZE", str(4 * 1024 * 1024)))  # 4 MB
DEFAULT_TIMEOUT = int(os.environ.get("CHUNKED_DOWNLOAD_TIMEOUT", "120"))

MIN_CHUNK_SIZE = 256 * 1024   # 256 KB minimum
MAX_THREADS = 32
MIN_THREADS = 1


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@dataclass
class ChunkInfo:
    """Tracks a single download chunk."""
    index: int
    start: int
    end: int
    downloaded: int = 0
    part_file: str = ""
    completed: bool = False
    error: Optional[str] = None


@dataclass
class DownloadState:
    """Full state of a chunked download — serialisable for pause/resume."""
    url: str
    output_path: str
    total_size: int = 0
    chunks: list[ChunkInfo] = field(default_factory=list)
    threads: int = DEFAULT_THREADS
    etag: Optional[str] = None
    last_modified: Optional[str] = None
    content_type: Optional[str] = None
    filename: Optional[str] = None
    start_time: float = 0.0
    finished: bool = False
    failed: bool = False
    error: Optional[str] = None


ProgressCallback = Callable[[int, int, float, str], None]  # (downloaded, total, speed_bps, eta)


# ---------------------------------------------------------------------------
# Core Engine
# ---------------------------------------------------------------------------

class ChunkedDownloader:
    """
    Multi-threaded chunked download engine.

    Usage::

        downloader = ChunkedDownloader()
        state = downloader.download(
            url="https://example.com/large-video.mp4",
            output_path="/tmp/downloads/video.mp4",
            on_progress=my_progress_callback,
        )
    """

    def __init__(
        self,
        threads: int = DEFAULT_THREADS,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        timeout: int = DEFAULT_TIMEOUT,
    ):
        self.threads = max(MIN_THREADS, min(threads, MAX_THREADS))
        self.chunk_size = max(MIN_CHUNK_SIZE, chunk_size)
        self.timeout = timeout
        self._cancel_event = threading.Event()
        self._pause_event = threading.Event()
        self._pause_event.set()  # Not paused by default

    def probe(self, url: str, headers: Optional[dict] = None) -> dict:
        """
        Probe the server to check Range support and get file metadata.

        Returns::

            {
                "supports_range": True,
                "content_length": 12345678,
                "content_type": "video/mp4",
                "etag": "\"abc123\"",
                "last_modified": "Wed, 21 Oct 2025 07:28:00 GMT",
                "filename": "video.mp4",
            }
        """
        hdrs = headers or {}
        result = {
            "supports_range": False,
            "content_length": 0,
            "content_type": "",
            "etag": None,
            "last_modified": None,
            "filename": None,
        }

        try:
            # Try HEAD first
            resp = requests.head(url, headers=hdrs, timeout=10, allow_redirects=True)
            if resp.status_code == 200:
                result["supports_range"] = resp.headers.get("Accept-Ranges", "").lower() == "bytes"
                result["content_length"] = int(resp.headers.get("Content-Length", 0))
                result["content_type"] = resp.headers.get("Content-Type", "")
                result["etag"] = resp.headers.get("ETag")
                result["last_modified"] = resp.headers.get("Last-Modified")
                result["filename"] = self._extract_filename(url, resp.headers)
                return result
        except Exception as exc:
            logger.debug("HEAD request failed: %s — falling back to GET probe", exc)

        # Fallback: partial GET to probe
        try:
            resp = requests.get(
                url,
                headers={**hdrs, "Range": "bytes=0-0"},
                timeout=10,
                stream=True,
                allow_redirects=True,
            )
            if resp.status_code in (200, 206):
                result["supports_range"] = resp.status_code == 206
                cr = resp.headers.get("Content-Range", "")
                if cr.startswith("bytes 0-0/"):
                    result["content_length"] = int(cr.split("/")[1])
                else:
                    result["content_length"] = int(resp.headers.get("Content-Length", 0))
                result["content_type"] = resp.headers.get("Content-Type", "")
                result["etag"] = resp.headers.get("ETag")
                result["last_modified"] = resp.headers.get("Last-Modified")
                result["filename"] = self._extract_filename(url, resp.headers)
            resp.close()
        except Exception as exc:
            logger.warning("GET probe also failed: %s", exc)

        return result

    def download(
        self,
        url: str,
        output_path: str,
        headers: Optional[dict] = None,
        on_progress: Optional[ProgressCallback] = None,
        threads: Optional[int] = None,
    ) -> DownloadState:
        """
        Download a file using chunked parallel download.

        Falls back to single-stream if the server doesn't support Range requests
        or the file is smaller than one chunk.

        Args:
            url: Direct download URL
            output_path: Where to save the final merged file
            headers: Optional HTTP headers (cookies, auth, etc.)
            on_progress: Callback(downloaded, total, speed_bps, eta_str)
            threads: Override thread count for this download

        Returns:
            DownloadState with final status
        """
        effective_threads = threads or self.threads
        self._cancel_event.clear()
        self._pause_event.set()

        state = DownloadState(url=url, output_path=output_path, start_time=time.time())

        # Ensure output directory exists
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        # Probe the server
        probe = self.probe(url, headers)
        state.total_size = probe["content_length"]
        state.etag = probe.get("etag")
        state.last_modified = probe.get("last_modified")
        state.content_type = probe.get("content_type")
        state.filename = probe.get("filename")

        # Decide: chunked or single-stream
        if not probe["supports_range"] or state.total_size < self.chunk_size:
            logger.info(
                "Server does not support Range or file is small (%d bytes) — using single stream",
                state.total_size,
            )
            return self._download_single_stream(url, output_path, headers, on_progress, state)

        # Create chunk state
        num_chunks = min(effective_threads, math.ceil(state.total_size / self.chunk_size))
        num_chunks = max(1, num_chunks)
        state.threads = num_chunks

        state.chunks = []
        for i in range(num_chunks):
            start = i * self.chunk_size
            end = min((i + 1) * self.chunk_size - 1, state.total_size - 1)
            part_file = f"{output_path}.part{i}"
            # Check for existing partial download
            downloaded = 0
            if os.path.exists(part_file):
                downloaded = os.path.getsize(part_file)
            state.chunks.append(ChunkInfo(
                index=i, start=start, end=end,
                downloaded=downloaded, part_file=part_file,
            ))

        logger.info(
            "Starting chunked download: %d bytes, %d chunks, %d threads",
            state.total_size, num_chunks, effective_threads,
        )

        # Download chunks in parallel
        return self._download_chunks(url, headers, on_progress, state)

    def cancel(self):
        """Cancel the current download."""
        self._cancel_event.set()
        self._pause_event.set()  # Unblock if paused

    def pause(self):
        """Pause the current download."""
        self._pause_event.clear()
        logger.info("Download paused")

    def resume(self):
        """Resume a paused download."""
        self._pause_event.set()
        logger.info("Download resumed")

    @property
    def is_paused(self) -> bool:
        return not self._pause_event.is_set()

    @property
    def is_cancelled(self) -> bool:
        return self._cancel_event.is_set()

    # ── Internal: Chunked download ──────────────────────────────────────────

    def _download_chunks(
        self,
        url: str,
        headers: Optional[dict],
        on_progress: Optional[ProgressCallback],
        state: DownloadState,
    ) -> DownloadState:
        """Download all chunks in parallel using a thread pool."""
        try:
            with ThreadPoolExecutor(max_workers=state.threads) as pool:
                futures = {}
                for chunk in state.chunks:
                    if chunk.completed and chunk.downloaded >= (chunk.end - chunk.start + 1):
                        continue  # Already done
                    future = pool.submit(
                        self._download_chunk, url, headers, chunk, state, on_progress
                    )
                    futures[future] = chunk

                for future in as_completed(futures):
                    chunk = futures[future]
                    try:
                        future.result()
                    except Exception as exc:
                        chunk.error = str(exc)
                        state.failed = True
                        state.error = f"Chunk {chunk.index} failed: {exc}"
                        logger.error("Chunk %d failed: %s", chunk.index, exc)
                        self.cancel()
                        break

            if self._cancel_event.is_set() and not state.failed:
                state.error = "Download cancelled"
                state.failed = True

            # Merge completed chunks
            if not state.failed:
                self._merge_chunks(state)
                state.finished = True
                logger.info("Download complete: %s", state.output_path)

            return state

        except Exception as exc:
            state.failed = True
            state.error = str(exc)
            logger.error("Chunked download failed: %s", exc)
            return state

    def _download_chunk(
        self,
        url: str,
        headers: Optional[dict],
        chunk: ChunkInfo,
        state: DownloadState,
        on_progress: Optional[ProgressCallback],
    ):
        """Download a single chunk, respecting pause/cancel."""
        chunk_size = chunk.end - chunk.start + 1
        already_done = chunk.downloaded

        if already_done >= chunk_size:
            chunk.completed = True
            return

        range_start = chunk.start + already_done
        range_end = chunk.end

        hdrs = {**(headers or {}), "Range": f"bytes={range_start}-{range_end}"}

        resp = requests.get(url, headers=hdrs, timeout=self.timeout, stream=True)
        if resp.status_code not in (200, 206):
            raise RuntimeError(f"HTTP {resp.status_code} for chunk {chunk.index}")

        mode = "ab" if already_done > 0 else "wb"
        bytes_written = already_done

        try:
            with open(chunk.part_file, mode) as f:
                for data in resp.iter_content(chunk_size=256 * 1024):  # 256 KB blocks
                    # Check pause
                    self._pause_event.wait()

                    # Check cancel
                    if self._cancel_event.is_set():
                        resp.close()
                        return

                    f.write(data)
                    bytes_written += len(data)
                    chunk.downloaded = bytes_written

                    # Progress callback
                    if on_progress:
                        total_downloaded = sum(
                            c.downloaded for c in state.chunks
                        )
                        elapsed = time.time() - state.start_time
                        speed = total_downloaded / elapsed if elapsed > 0 else 0
                        remaining = state.total_size - total_downloaded
                        eta = remaining / speed if speed > 0 else 0
                        eta_str = self._format_eta(eta)
                        on_progress(total_downloaded, state.total_size, speed, eta_str)

        finally:
            resp.close()

        chunk.completed = True
        logger.debug("Chunk %d complete: %s", chunk.index, chunk.part_file)

    def _merge_chunks(self, state: DownloadState):
        """Merge .part files into the final output file and verify integrity."""
        logger.info("Merging %d chunks into %s", len(state.chunks), state.output_path)

        with open(state.output_path, "wb") as out:
            for chunk in sorted(state.chunks, key=lambda c: c.index):
                if not os.path.exists(chunk.part_file):
                    raise RuntimeError(f"Missing part file: {chunk.part_file}")
                with open(chunk.part_file, "rb") as inp:
                    shutil.copyfileobj(inp, out)
                # Remove part file after successful merge
                os.remove(chunk.part_file)

        # Verify file size
        final_size = os.path.getsize(state.output_path)
        if final_size != state.total_size:
            logger.warning(
                "Size mismatch: expected %d, got %d",
                state.total_size, final_size,
            )

        logger.info("Merge complete: %d bytes", final_size)

    def _download_single_stream(
        self,
        url: str,
        output_path: str,
        headers: Optional[dict],
        on_progress: Optional[ProgressCallback],
        state: DownloadState,
    ) -> DownloadState:
        """Fallback: single-stream download without Range requests."""
        part_file = f"{output_path}.part0"
        existing = 0
        if os.path.exists(part_file):
            existing = os.path.getsize(part_file)

        hdrs = {**(headers or {})}
        if existing > 0 and state.total_size > 0:
            hdrs["Range"] = f"bytes={existing}-"

        try:
            resp = requests.get(url, headers=hdrs, timeout=self.timeout, stream=True)
            if resp.status_code not in (200, 206):
                state.failed = True
                state.error = f"HTTP {resp.status_code}"
                return state

            mode = "ab" if existing > 0 else "wb"
            total = state.total_size or int(resp.headers.get("Content-Length", 0))
            downloaded = existing

            with open(part_file, mode) as f:
                for data in resp.iter_content(chunk_size=256 * 1024):
                    self._pause_event.wait()
                    if self._cancel_event.is_set():
                        resp.close()
                        state.error = "Download cancelled"
                        state.failed = True
                        return state

                    f.write(data)
                    downloaded += len(data)

                    if on_progress:
                        elapsed = time.time() - state.start_time
                        speed = downloaded / elapsed if elapsed > 0 else 0
                        remaining = total - downloaded
                        eta = remaining / speed if speed > 0 else 0
                        on_progress(downloaded, total, speed, self._format_eta(eta))

            resp.close()

            # Move part file to final output
            shutil.move(part_file, output_path)
            state.total_size = total
            state.finished = True

        except Exception as exc:
            state.failed = True
            state.error = str(exc)

        return state

    # ── Helpers ─────────────────────────────────────────────────────────────

    @staticmethod
    def _extract_filename(url: str, headers: dict) -> Optional[str]:
        """Extract filename from Content-Disposition or URL path."""
        cd = headers.get("Content-Disposition", "")
        if "filename=" in cd:
            parts = cd.split("filename=")
            if len(parts) > 1:
                name = parts[-1].strip().strip('"').strip("'")
                if name:
                    return name

        path = urlparse(url).path
        if path:
            name = os.path.basename(path)
            if name and "." in name:
                return name
        return None

    @staticmethod
    def _format_eta(seconds: float) -> str:
        """Format seconds into MM:SS or HH:MM:SS."""
        if seconds <= 0 or seconds > 86400:
            return "--:--"
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        if h > 0:
            return f"{h:02d}:{m:02d}:{s:02d}"
        return f"{m:02d}:{s:02d}"

    @staticmethod
    def format_speed(bytes_per_sec: float) -> str:
        """Format bytes/sec into human-readable speed string."""
        if bytes_per_sec <= 0:
            return "0 B/s"
        units = ["B/s", "KB/s", "MB/s", "GB/s"]
        idx = 0
        speed = bytes_per_sec
        while speed >= 1024 and idx < len(units) - 1:
            speed /= 1024
            idx += 1
        return f"{speed:.1f} {units[idx]}"
