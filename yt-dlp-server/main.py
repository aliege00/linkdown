"""
VidFetch yt-dlp Server
======================

FastAPI server that wraps yt-dlp (and gallery-dl as fallback) for video
metadata extraction and download streaming.

Usage:
    python main.py
    # or
    uvicorn main:app --host 0.0.0.0 --port 8080
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("vidfetch.server")

# ── Auto-updater (runs in background on import/startup) ─────────────────────
from auto_update import start_auto_updater, get_update_status  # noqa: E402
from dependency_checker import startup_check as check_ffmpeg_startup, get_dependency_status

update_stop_event = start_auto_updater()

# ── Config ───────────────────────────────────────────────────────────────────
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8080"))
DOWNLOAD_DIR = Path(os.environ.get("DOWNLOAD_DIR", "/tmp/vidfetch-downloads"))
CLEANUP_AGE = int(os.environ.get("CLEANUP_AGE_SECONDS", "1800"))
MAX_FILE_SIZE = int(os.environ.get("MAX_FILE_SIZE", "2147483648"))  # 2 GB
GALLERYDL_TIMEOUT = int(os.environ.get("GALLERYDL_TIMEOUT", "300"))

# YouTube anti-bot (optional)
YTDLP_COOKIES_FILE = os.environ.get("YTDLP_COOKIES_FILE", "")
YTDLP_PO_TOKEN_PROVIDER = os.environ.get("YTDLP_PO_TOKEN_PROVIDER", "")
YTDLP_PLAYER_CLIENT = os.environ.get("YTDLP_PLAYER_CLIENT", "")

DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ── FastAPI App ──────────────────────────────────────────────────────────────
app = FastAPI(title="VidFetch yt-dlp Server", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _run_cmd(args: list[str], timeout: int = 60) -> subprocess.CompletedProcess:
    """Run a command and return the result."""
    logger.info("Running: %s", " ".join(args))
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


def _build_ytdlp_args(url: str, extra: list[str] | None = None) -> list[str]:
    """Build the base yt-dlp command with optional anti-bot flags."""
    cmd = ["yt-dlp", "--no-playlist", "-o", "-"]
    if YTDLP_COOKIES_FILE and os.path.exists(YTDLP_COOKIES_FILE):
        cmd += ["--cookies", YTDLP_COOKIES_FILE]
    if YTDLP_PO_TOKEN_PROVIDER:
        cmd += ["--extractor-args", f"youtube:player_client=web"]
    if YTDLP_PLAYER_CLIENT:
        cmd += ["--extractor-args", f"youtube:player_client={YTDLP_PLAYER_CLIENT}"]
    if extra:
        cmd += extra
    return cmd + [url]


def _build_gallerydl_args(url: str) -> list[str]:
    """Build gallery-dl command."""
    return ["gallery-dl", "-g", url]


def _parse_video_info(json_str: str) -> dict:
    """Parse yt-dlp --dump-json output into a clean response."""
    import json
    data = json.loads(json_str)

    formats = []
    for f in data.get("formats", []):
        formats.append({
            "format_id": f.get("format_id", ""),
            "ext": f.get("ext", ""),
            "resolution": f.get("resolution", "audio only" if f.get("vcodec") == "none" else "unknown"),
            "filesize": f.get("filesize") or f.get("filesize_approx"),
            "vcodec": f.get("vcodec"),
            "acodec": f.get("acodec"),
            "fps": f.get("fps"),
            "tbr": f.get("tbr"),
        })

    # Determine best combined format
    best_id = "best"
    best_fmts = [f for f in data.get("formats", []) if f.get("vcodec") != "none" and f.get("acodec") != "none"]
    if best_fmts:
        best_fmts.sort(key=lambda x: x.get("tbr") or 0, reverse=True)
        best_id = best_fmts[0]["format_id"]

    # Best audio-only
    audio_fmts = [f for f in data.get("formats", []) if f.get("vcodec") == "none" and f.get("acodec") != "none"]
    best_audio = audio_fmts[-1]["format_id"] if audio_fmts else None

    return {
        "success": True,
        "id": data.get("id", ""),
        "title": data.get("title", "Unknown"),
        "duration": data.get("duration"),
        "thumbnail": data.get("thumbnail"),
        "uploader": data.get("uploader") or data.get("channel") or "Unknown",
        "uploader_url": data.get("uploader_url") or data.get("channel_url"),
        "webpage_url": data.get("webpage_url", ""),
        "formats": formats,
        "best_format_id": best_id,
        "best_audio_format_id": best_audio,
        "ffmpeg_available": shutil.which("ffmpeg") is not None,
    }


def _cleanup_old_files() -> None:
    """Remove files older than CLEANUP_AGE seconds."""
    now = time.time()
    for f in DOWNLOAD_DIR.iterdir():
        if f.is_file() and (now - f.stat().st_mtime) > CLEANUP_AGE:
            try:
                f.unlink()
                logger.info("Cleaned up: %s", f.name)
            except Exception:
                pass


# Periodic cleanup thread
def _cleanup_loop() -> None:
    while True:
        time.sleep(300)  # every 5 min
        try:
            _cleanup_old_files()
        except Exception as exc:
            logger.debug("Cleanup error: %s", exc)


# ── API Routes ───────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    """Health check endpoint."""
    status = get_update_status()
    ffmpeg_status = get_dependency_status()
    return {
        "status": "ok",
        "version": status["installed"],
        "latest_version": status["latest"],
        "update_available": status["update_available"],
        "engines": {
            "yt-dlp": status["installed"],
            "gallery-dl": "available" if shutil.which("gallery-dl") else "not found",
        },
        "dependencies": {
            "ffmpeg": ffmpeg_status,
        },
    }


@app.get("/api/update-status")
def update_status():
    """Check if a yt-dlp update is available."""
    return get_update_status()


@app.get("/api/info")
def info(url: str = Query(...), is_playlist: bool = Query(False)):
    """Extract video metadata and available formats."""
    if not url.strip():
        raise HTTPException(400, "URL is required")

    _cleanup_old_files()

    try:
        cmd = _build_ytdlp_args(url, [
            "--dump-json",
            "--flat-playlist" if is_playlist else "--no-playlist",
        ])
        result = _run_cmd(cmd, timeout=60)

        if result.returncode != 0:
            # Try gallery-dl as fallback
            try:
                gcmd = _build_gallerydl_args(url)
                gresult = _run_cmd(gcmd, timeout=GALLERYDL_TIMEOUT)
                if gresult.returncode == 0:
                    urls = [u.strip() for u in gresult.stdout.strip().split("\n") if u.strip()]
                    return {
                        "success": True,
                        "id": hashlib.md5(url.encode()).hexdigest()[:12],
                        "title": "Gallery download",
                        "duration": None,
                        "thumbnail": None,
                        "uploader": "gallery-dl",
                        "uploader_url": None,
                        "webpage_url": url,
                        "formats": [{
                            "format_id": "gallery",
                            "ext": "zip" if len(urls) > 1 else "auto",
                            "resolution": f"{len(urls)} file(s)" if len(urls) > 1 else "single file",
                            "filesize": None,
                            "vcodec": None,
                            "acodec": None,
                            "fps": None,
                            "tbr": None,
                        }],
                        "best_format_id": "gallery",
                        "best_audio_format_id": None,
                        "ffmpeg_available": False,
                        "engine": "gallery-dl",
                    }
            except Exception:
                pass

            error_msg = result.stderr.strip()[-500:] if result.stderr else "Failed to extract info"
            return {"success": False, "error": error_msg}

        import json
        raw = json.loads(result.stdout)

        if is_playlist and "entries" in raw:
            # Flat playlist — return entry list
            entries = []
            for entry in raw.get("entries", []):
                if entry is None:
                    continue
                entries.append({
                    "id": entry.get("id", ""),
                    "title": entry.get("title", "Unknown"),
                    "url": entry.get("url") or entry.get("webpage_url") or f"https://www.youtube.com/watch?v={entry.get('id', '')}",
                    "duration": entry.get("duration"),
                    "thumbnail": entry.get("thumbnail"),
                })

            return {
                "success": True,
                "id": raw.get("id", ""),
                "title": raw.get("title", "Playlist"),
                "duration": None,
                "thumbnail": raw.get("thumbnail"),
                "uploader": raw.get("uploader") or raw.get("channel") or "Unknown",
                "uploader_url": raw.get("uploader_url"),
                "webpage_url": raw.get("webpage_url", url),
                "formats": [],
                "best_format_id": "best",
                "best_audio_format_id": None,
                "ffmpeg_available": shutil.which("ffmpeg") is not None,
                "is_playlist": True,
                "count": raw.get("playlist_count") or len(entries),
                "entries": entries,
            }

        return _parse_video_info(result.stdout)

    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Analysis timed out (60s limit)"}
    except Exception as exc:
        logger.exception("info error")
        return {"success": False, "error": str(exc)}


@app.get("/api/download")
def download(
    url: str = Query(...),
    format_id: str = Query("best"),
    is_playlist: bool = Query(False),
    limit: int = Query(0),
):
    """Download a video (or playlist as ZIP) and stream it to the client."""
    if not url.strip():
        raise HTTPException(400, "URL is required")

    _cleanup_old_files()

    try:
        if is_playlist:
            return _download_playlist(url, format_id, limit)
        return _download_single(url, format_id)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("download error")
        raise HTTPException(500, str(exc))


def _download_single(url: str, format_id: str) -> FileResponse:
    """Download a single video."""
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    output_template = str(DOWNLOAD_DIR / f"vid_{timestamp}_%(id)s.%(ext)s")

    cmd = [
        "yt-dlp",
        "-f", format_id,
        "--no-playlist",
        "-o", output_template,
        "--no-overwrites",
    ]
    if YTDLP_COOKIES_FILE and os.path.exists(YTDLP_COOKIES_FILE):
        cmd += ["--cookies", YTDLP_COOKIES_FILE]
    if YTDLP_PLAYER_CLIENT:
        cmd += ["--extractor-args", f"youtube:player_client={YTDLP_PLAYER_CLIENT}"]
    cmd.append(url)

    result = _run_cmd(cmd, timeout=300)

    if result.returncode != 0:
        raise HTTPException(500, result.stderr.strip()[-500:] if result.stderr else "Download failed")

    # Find the downloaded file
    for f in sorted(DOWNLOAD_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if f.is_file() and f.stat().st_mtime > time.time() - 300:
            return FileResponse(
                path=str(f),
                filename=f.name,
                media_type="application/octet-stream",
            )

    raise HTTPException(500, "Downloaded file not found")


def _download_playlist(url: str, format_id: str, limit: int) -> FileResponse:
    """Download a playlist as a ZIP archive."""
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    zip_path = DOWNLOAD_DIR / f"playlist_{timestamp}.zip"

    # First extract info
    cmd = _build_ytdlp_args(url, ["--dump-json", "--flat-playlist"])
    result = _run_cmd(cmd, timeout=60)
    if result.returncode != 0:
        raise HTTPException(500, "Failed to extract playlist info")

    import json
    raw = json.loads(result.stdout)
    entries = [e for e in raw.get("entries", []) if e is not None]
    if limit > 0:
        entries = entries[:limit]

    if not entries:
        raise HTTPException(404, "Playlist is empty")

    # Download each video
    temp_dir = Path(tempfile.mkdtemp(prefix="vidfetch_pl_"))
    try:
        for idx, entry in enumerate(entries, 1):
            entry_url = entry.get("url") or entry.get("webpage_url") or f"https://www.youtube.com/watch?v={entry.get('id', '')}"
            out_template = str(temp_dir / f"{idx:03d}_%(title)s.%(ext)s")

            dl_cmd = ["yt-dlp", "-f", format_id, "-o", out_template, "--no-overwrites"]
            if YTDLP_COOKIES_FILE and os.path.exists(YTDLP_COOKIES_FILE):
                dl_cmd += ["--cookies", YTDLP_COOKIES_FILE]
            if YTDLP_PLAYER_CLIENT:
                dl_cmd += ["--extractor-args", f"youtube:player_client={YTDLP_PLAYER_CLIENT}"]
            dl_cmd.append(entry_url)

            _run_cmd(dl_cmd, timeout=300)

        # Create ZIP
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in temp_dir.iterdir():
                if f.is_file():
                    zf.write(f, f.name)

        return FileResponse(
            path=str(zip_path),
            filename=f"playlist_{timestamp}.zip",
            media_type="application/zip",
        )
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


# ── Chunked Download (Multi-Threaded / Range Requests) ──────────────────────

from chunked_downloader import ChunkedDownloader
from resume_download import ResumeManager, ResumeState

resume_manager = ResumeManager(str(DOWNLOAD_DIR))
active_downloaders: dict[str, ChunkedDownloader] = {}


class ChunkProgress(BaseModel):
    downloaded: int
    total: int
    speed_bps: float
    eta: str
    percent: float
    chunks_completed: int = 0
    chunks_total: int = 0


@app.get("/api/chunked/probe")
def chunked_probe(url: str = Query(...)):
    """
    Probe a URL to check Range support and file metadata.
    Use this to decide whether to use chunked download.
    """
    dl = ChunkedDownloader()
    try:
        info = dl.probe(url)
        return {
            "success": True,
            "supports_range": info["supports_range"],
            "content_length": info["content_length"],
            "content_type": info["content_type"],
            "filename": info["filename"],
            "recommended_threads": min(
                DEFAULT_THREADS,
                max(1, info["content_length"] // (4 * 1024 * 1024))
            ) if info["supports_range"] else 1,
        }
    except Exception as exc:
        return {"success": False, "error": str(exc)}


@app.get("/api/chunked/download")
def chunked_download_start(
    url: str = Query(...),
    output_name: str = Query("download"),
    threads: int = Query(DEFAULT_THREADS),
):
    """
    Start a chunked download. Returns a download_id for progress tracking.
    The download runs in a background thread.
    """
    import uuid

    download_id = str(uuid.uuid4())[:8]
    output_path = str(DOWNLOAD_DIR / f"{download_id}_{output_name}")
    dl = ChunkedDownloader(threads=threads)
    active_downloaders[download_id] = dl

    # Store state for resume
    state = ResumeState(
        url=url,
        output_path=output_path,
        threads=threads,
    )
    resume_manager.save_state(state)

    # Start background download
    def _run():
        try:
            def _progress(downloaded, total, speed, eta):
                dl._last_progress = {
                    "downloaded": downloaded,
                    "total": total,
                    "speed_bps": speed,
                    "eta": eta,
                    "percent": (downloaded / total * 100) if total > 0 else 0,
                }

            result = dl.download(url, output_path, on_progress=_progress)
            dl._last_result = result
        except Exception as exc:
            dl._last_result = type("R", (), {"failed": True, "error": str(exc)})()
        finally:
            active_downloaders.pop(download_id, None)

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    return {
        "success": True,
        "download_id": download_id,
        "output_path": output_path,
    }


@app.get("/api/chunked/progress/{download_id}")
def chunked_progress(download_id: str):
    """Get progress of an active chunked download."""
    dl = active_downloaders.get(download_id)
    if not dl:
        return {"success": False, "error": "Download not found or completed"}

    progress = getattr(dl, "_last_progress", None)
    result = getattr(dl, "_last_result", None)

    if result:
        return {
            "success": not result.failed,
            "finished": getattr(result, "finished", False),
            "failed": getattr(result, "failed", False),
            "error": getattr(result, "error", None),
            "output_path": getattr(result, "output_path", ""),
        }

    if progress:
        return {"success": True, **progress}

    return {"success": True, "downloaded": 0, "total": 0, "percent": 0}


@app.post("/api/chunked/pause/{download_id}")
def chunked_pause(download_id: str):
    """Pause an active chunked download."""
    dl = active_downloaders.get(download_id)
    if not dl:
        return {"success": False, "error": "Download not found"}
    dl.pause()
    return {"success": True, "paused": True}


@app.post("/api/chunked/resume/{download_id}")
def chunked_resume(download_id: str):
    """Resume a paused chunked download."""
    dl = active_downloaders.get(download_id)
    if not dl:
        return {"success": False, "error": "Download not found"}
    dl.resume()
    return {"success": True, "resumed": True}


@app.post("/api/chunked/cancel/{download_id}")
def chunked_cancel(download_id: str):
    """Cancel a chunked download and clean up .part files."""
    dl = active_downloaders.get(download_id)
    if not dl:
        return {"success": False, "error": "Download not found"}
    dl.cancel(cleanup=True)
    return {"success": True, "cancelled": True}


@app.get("/api/resumable/list")
def resumable_list():
    """List all downloads that can be resumed."""
    states = resume_manager.list_resumable()
    return {
        "success": True,
        "downloads": [
            {
                "url": s.url,
                "output_path": s.output_path,
                "total_size": s.total_size,
                "downloaded": sum(c.get("downloaded", 0) for c in s.chunks),
                "percent": (
                    sum(c.get("downloaded", 0) for c in s.chunks) / s.total_size * 100
                    if s.total_size > 0 else 0
                ),
                "updated_at": s.updated_at,
            }
            for s in states
        ],
    }


@app.get("/api/resumable/info")
def resumable_info(output_path: str = Query(...)):
    """Get resume info for a specific download."""
    info = resume_manager.get_resume_info(output_path)
    if not info:
        return {"success": False, "error": "No resumable state found"}
    return {"success": True, **info}


# ── Startup ──────────────────────────────────────────────────────────────────

@app.on_event("startup")
def on_startup():
    logger.info("VidFetch yt-dlp Server starting on %s:%s", HOST, PORT)
    logger.info("Download dir: %s", DOWNLOAD_DIR)
    logger.info("yt-dlp version: %s", _current_version())

    # Check FFmpeg availability (non-blocking — downloads in background if missing)
    ffmpeg_path = check_ffmpeg_startup()
    if ffmpeg_path:
        logger.info("FFmpeg available: %s", ffmpeg_path)
    else:
        logger.info("FFmpeg not found — downloading in background...")

    # Start cleanup thread (removes old downloads + orphan .part/.state files)
    cleanup_thread = threading.Thread(target=_cleanup_loop, daemon=True)
    cleanup_thread.start()

    # Clean up orphan .state files on startup
    resume_manager.cleanup_stale(max_age_hours=24)
    logger.info("Startup orphan cleanup complete")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
