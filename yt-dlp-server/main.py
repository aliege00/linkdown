"""
VidFetch yt-dlp Server
=======================
Self-hosted API server that wraps yt-dlp to extract video metadata
and download videos from YouTube, TikTok, Twitter/X, Instagram, and 1000+ sites.

Endpoints:
  GET /api/info?url=<encoded_url>       → Video metadata + available formats
  GET /api/download?url=<encoded_url>   → Download video (streaming)

Deploy anywhere: Railway, Fly.io, Render, or your own VPS.
"""

import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8080"))
DOWNLOAD_DIR = Path(os.getenv("DOWNLOAD_DIR", "/tmp/vidfetch-downloads"))
CLEANUP_AGE_SECONDS = int(os.getenv("CLEANUP_AGE_SECONDS", "1800"))  # 30 min
MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE", str(2 * 1024**3)))  # 2 GB

DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Check for ffmpeg (needed for merging video+audio streams)
FFMPEG_AVAILABLE = shutil.which("ffmpeg") is not None

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    yield
    # Shutdown — cleanup all downloaded files
    shutil.rmtree(DOWNLOAD_DIR, ignore_errors=True)


app = FastAPI(
    title="VidFetch yt-dlp API",
    version="1.0.0",
    description="Self-hosted video download API powered by yt-dlp. Supports 1000+ sites.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

URL_PATTERN = re.compile(
    r"^https?://"  # http:// or https://
    r"(?:[-\w.]|(?:%[\da-fA-F]{2}))+"  # domain
    r"(?::\d+)?"  # optional port
    r"(?:/[-\w%.~+]*)*"  # path
    r"(?:\?[-\w&=%.~+]*)?",  # query string
    re.IGNORECASE,
)


def validate_url(url: str) -> str:
    """Validate and normalize the URL. Raises 400 if invalid."""
    if not url or not URL_PATTERN.match(url):
        raise HTTPException(status_code=400, detail="Invalid URL format")
    return url


def run_ytdlp(args: List[str]) -> Dict[str, Any]:
    """Run yt-dlp with the given args and return parsed JSON output."""
    cmd = ["yt-dlp", "--no-warnings", "--no-cache-dir"] + args
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            stderr = result.stderr.strip()
            raise RuntimeError(stderr or "yt-dlp failed")
        return result
    except subprocess.TimeoutExpired:
        raise RuntimeError("yt-dlp timed out after 120 seconds")
    except FileNotFoundError:
        raise RuntimeError(
            "yt-dlp is not installed. Install it with: pip install yt-dlp"
        )


def sanitize_filename(name: str) -> str:
    """Remove or replace characters that are problematic in filenames."""
    return re.sub(r'[^\w\-_.() ]', "_", name)[:100]


def cleanup_old_files():
    """Remove downloaded files older than CLEANUP_AGE_SECONDS."""
    now = time.time()
    for f in DOWNLOAD_DIR.iterdir():
        if f.is_file() and (now - f.stat().st_mtime) > CLEANUP_AGE_SECONDS:
            try:
                f.unlink()
            except OSError:
                pass


def simplify_formats(raw_formats: List[Dict]) -> List[Dict]:
    """Flatten yt-dlp formats into a clean, client-friendly list."""
    seen = set()
    clean = []
    for f in raw_formats:
        fmt_id = f.get("format_id", "")
        ext = f.get("ext", "")
        vcodec = f.get("vcodec", "none")
        acodec = f.get("acodec", "none")

        # Skip text-only formats (subtitles, etc.)
        if vcodec == "none" and acodec == "none":
            continue

        # Skip formats with no usable URL
        if not f.get("url") and not f.get("manifest_url"):
            continue

        # Build a resolution label
        width = f.get("width") or 0
        height = f.get("height") or 0
        if width and height:
            resolution = f"{width}x{height}"
        elif f.get("resolution") and f["resolution"] != "None":
            resolution = f["resolution"]
        else:
            resolution = "audio only" if vcodec == "none" else "unknown"

        # Deduplicate
        key = (fmt_id, resolution, ext)
        if key in seen:
            continue
        seen.add(key)

        clean.append(
            {
                "format_id": fmt_id,
                "ext": ext,
                "resolution": resolution,
                "filesize": f.get("filesize") or f.get("filesize_approx"),
                "vcodec": vcodec if vcodec != "none" else None,
                "acodec": acodec if acodec != "none" else None,
                "fps": f.get("fps"),
                "tbr": round(f.get("tbr", 0)) if f.get("tbr") else None,
            }
        )

    # Sort: video formats by resolution desc, then audio
    def sort_key(f: Dict):
        if f["vcodec"] and f["acodec"]:
            res = f["resolution"]
            h = int(res.split("x")[1]) if "x" in res else 0
            return (0, -h, -(f["tbr"] or 0))
        elif f["vcodec"]:
            return (1, 0, 0)
        else:
            return (2, 0, -(f["tbr"] or 0))

    clean.sort(key=sort_key)
    return clean


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/info")
def get_video_info(
    url: str = Query(..., description="Video URL to extract info from"),
):
    """
    Extract video metadata and available formats from any supported URL.
    Returns title, thumbnail, duration, uploader, and a clean list of formats.
    """
    validate_url(url)

    try:
        result = run_ytdlp(
            [
                "--dump-json",
                "--no-download",
                "--no-playlist",
                "--flat-playlist",
                url,
            ]
        )

        info = result.stdout.strip().split("\n")[0]
        import json

        data = json.loads(info)

        raw_formats = data.get("formats") or []
        # If flat playlist, formats may be empty; try again without --flat-playlist
        if not raw_formats:
            result2 = run_ytdlp(
                [
                    "--dump-json",
                    "--no-download",
                    "--no-playlist",
                    url,
                ]
            )
            info2 = result2.stdout.strip().split("\n")[0]
            data = json.loads(info2)
            raw_formats = data.get("formats") or []

        formats = simplify_formats(raw_formats)

        # Build a "best" format suggestion
        best_video = None
        best_audio = None
        for f in formats:
            if f["vcodec"] and f["acodec"]:
                best_video = f["format_id"]
                break
            elif f["vcodec"] and not best_video:
                best_video = f["format_id"]
        for f in formats:
            if not f["vcodec"] and f["acodec"]:
                best_audio = f["format_id"]
                break

        return {
            "success": True,
            "id": data.get("id"),
            "title": data.get("title", "Unknown"),
            "duration": data.get("duration"),
            "thumbnail": data.get("thumbnail"),
            "uploader": data.get("uploader") or data.get("channel") or "Unknown",
            "uploader_url": data.get("uploader_url") or data.get("channel_url"),
            "webpage_url": data.get("webpage_url") or url,
            "formats": formats,
            "best_format_id": best_video or "best",
            "best_audio_format_id": best_audio,
            "ffmpeg_available": FFMPEG_AVAILABLE,
        }

    except RuntimeError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Failed to parse video info")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")


@app.get("/api/download")
def download_video(
    url: str = Query(..., description="Video URL to download"),
    format_id: str = Query("best", description="Format ID to download"),
):
    """
    Download a video from the given URL in the specified format.
    Streams the file directly to the client as a download attachment.
    """
    validate_url(url)

    # Create a unique session ID for this download
    session_id = str(uuid.uuid4())
    output_template = str(DOWNLOAD_DIR / f"{session_id}.%(ext)s")

    try:
        # Build format string
        if format_id == "best":
            fmt = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
        elif format_id == "bestaudio":
            fmt = "bestaudio[ext=m4a]/bestaudio/best"
        else:
            fmt = format_id

        ydl_opts = [
            "--format",
            fmt,
            "--output",
            output_template,
            "--no-playlist",
            "--no-warnings",
            "--no-cache-dir",
            "--merge-output-format",
            "mp4",
        ]

        result = run_ytdlp(ydl_opts + [url])

        # Find the downloaded file
        downloaded_files = list(DOWNLOAD_DIR.glob(f"{session_id}.*"))
        if not downloaded_files:
            # Try to find by searching for any recently modified file
            candidates = sorted(
                DOWNLOAD_DIR.iterdir(), key=lambda f: f.stat().st_mtime, reverse=True
            )
            for c in candidates[:5]:
                if c.stat().st_mtime > time.time() - 30:
                    downloaded_files = [c]
                    break

        if not downloaded_files:
            raise RuntimeError("Download completed but output file not found")

        file_path = downloaded_files[0]
        if file_path.stat().st_size > MAX_FILE_SIZE:
            file_path.unlink()
            raise HTTPException(status_code=413, detail="File exceeds maximum size limit")

        # Cleanup old files in background
        cleanup_old_files()

        return FileResponse(
            path=str(file_path),
            filename=f"vidfetch_{sanitize_filename(session_id)}{file_path.suffix}",
            media_type="application/octet-stream",
            headers={
                "X-Session-Id": session_id,
                "X-File-Size": str(file_path.stat().st_size),
            },
        )

    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")


@app.get("/api/health")
def health_check():
    """Health check endpoint to verify the server is running."""
    return {
        "status": "ok",
        "yt_dlp_installed": shutil.which("yt-dlp") is not None,
        "ffmpeg_available": FFMPEG_AVAILABLE,
        "download_dir": str(DOWNLOAD_DIR),
        "cleanup_age_seconds": CLEANUP_AGE_SECONDS,
    }


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)
