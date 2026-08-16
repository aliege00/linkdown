"""
VidFetch yt-dlp Server
=======================
Self-hosted API server that wraps yt-dlp to extract video metadata
and download videos from YouTube, TikTok, Twitter/X, Instagram, and 1000+ sites.

Endpoints:
  GET /api/info?url=<encoded_url>[&is_playlist=true]
      → Video metadata + available formats (or playlist entries when the URL
        is a playlist / is_playlist=true)
  GET /api/download?url=<encoded_url>[&format_id=best][&is_playlist=true][&limit=N]
      → Download video (streaming), or download a whole playlist as a ZIP

Deploy anywhere: Railway, Fly.io, Render, or your own VPS.
"""

import json
import os
import re
import shutil
import subprocess
import time
import uuid
import zipfile
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

# ── YouTube anti-bot mitigations (optional) ──────────────────────────
# YouTube increasingly requires real browser cookies or a PO token provider
# to bypass the "Sign in to confirm you're not a bot" check from flagged IPs.
#
#   YTDLP_COOKIES_FILE       path to a Netscape-format cookies.txt exported
#                            from a logged-in browser session
#   YTDLP_PO_TOKEN_PROVIDER  URL of a bgutil-ytdlp-pot-provider server
#                            (e.g. http://127.0.0.1:4416) — requires the
#                            bgutil plugin installed next to yt-dlp
#   YTDLP_PLAYER_CLIENT      optional YouTube player client override, e.g.
#                            "tv" or "web_embedded" (fewer bot checks, but
#                            some formats may be unavailable)
COOKIES_FILE = os.getenv("YTDLP_COOKIES_FILE", "")
PO_TOKEN_PROVIDER = os.getenv("YTDLP_PO_TOKEN_PROVIDER", "")
PLAYER_CLIENT = os.getenv("YTDLP_PLAYER_CLIENT", "")

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
    version="1.1.0",
    description="Self-hosted video download API powered by yt-dlp. Supports 1000+ sites, including YouTube playlists.",
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
    r"(?:/[-%\w.~+]*)*"  # path
    r"(?:\?[-\w&=%.~+]*)?",  # query string
    re.IGNORECASE,
)

# Cheap URL-based playlist hint (YouTube playlists, generic /playlist/ paths).
PLAYLIST_URL_PATTERN = re.compile(
    r"[?&]list=[^&\s]+|/playlist([/?]|$)|/playlists?/|&playlist=",
    re.IGNORECASE,
)


def validate_url(url: str) -> str:
    """Validate and normalize the URL. Raises 400 if invalid."""
    if not url or not URL_PATTERN.match(url):
        raise HTTPException(status_code=400, detail="Invalid URL format")
    return url


def looks_like_playlist(url: str) -> bool:
    """Best-effort URL check for playlists. The server also relies on
    yt-dlp's own response, so a false positive just means the analyze runs
    in playlist mode and reports back a single video."""
    return bool(PLAYLIST_URL_PATTERN.search(url))


def run_ytdlp(args: List[str], timeout: int = 120) -> subprocess.CompletedProcess:
    """Run yt-dlp with the given args and return the completed process.

    `timeout` defaults to 120s for quick metadata calls; playlist downloads
    pass a much larger budget because they download many videos.

    Anti-bot args (cookies / PO token provider / player client) are appended
    from the environment when configured, so every request is authenticated
    the same way.
    """
    cmd = ["yt-dlp", "--no-warnings", "--no-cache-dir"]
    if COOKIES_FILE and os.path.exists(COOKIES_FILE):
        cmd += ["--cookies", COOKIES_FILE]
    if PO_TOKEN_PROVIDER:
        cmd += [
            "--extractor-args",
            f"youtubepot-bgutilhttp:base_url={PO_TOKEN_PROVIDER}",
        ]
    if PLAYER_CLIENT:
        cmd += [
            "--extractor-args",
            f"youtube:player_client={PLAYER_CLIENT}",
        ]
    cmd += args
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if result.returncode != 0:
            stderr = result.stderr.strip()
            raise RuntimeError(stderr or "yt-dlp failed")
        return result
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"yt-dlp timed out after {timeout} seconds")
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


def build_format_selector(format_id: str) -> str:
    """Translate the client's format_id into a yt-dlp format selector."""
    if format_id == "best":
        return "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
    if format_id == "bestaudio":
        return "bestaudio[ext=m4a]/bestaudio/best"
    return format_id


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


def build_best_format_ids(formats: List[Dict]) -> Dict[str, Optional[str]]:
    """Pick a 'best' combined format and a 'best' audio-only format."""
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
    return {"best_video": best_video or "best", "best_audio": best_audio}


def parse_playlist_info(root: Dict[str, Any], url: str) -> Dict[str, Any]:
    """Build the playlist-shaped response from a --flat-playlist dump."""
    raw_entries = root.get("entries")
    if raw_entries is None:
        return {}

    entries = []
    for e in raw_entries:
        if not e:
            continue
        entries.append(
            {
                "id": e.get("id", ""),
                "title": e.get("title") or e.get("fulltitle") or "",
                "url": e.get("url") or e.get("webpage_url") or "",
                "duration": e.get("duration"),
                "thumbnail": e.get("thumbnail"),
            }
        )

    return {
        "success": True,
        "is_playlist": True,
        "id": root.get("id", ""),
        "title": root.get("title", "Playlist"),
        "duration": None,
        "thumbnail": root.get("thumbnail"),
        "uploader": root.get("uploader") or root.get("channel") or "Unknown",
        "uploader_url": root.get("uploader_url") or root.get("channel_url"),
        "webpage_url": root.get("webpage_url") or url,
        "formats": [],
        "best_format_id": "best",
        "best_audio_format_id": None,
        "ffmpeg_available": FFMPEG_AVAILABLE,
        "count": len(entries),
        "entries": entries,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/info")
def get_video_info(
    url: str = Query(..., description="Video or playlist URL to extract info from"),
    is_playlist: bool = Query(
        False, description="Hint that the URL is a playlist (server also auto-detects)"
    ),
):
    """
    Extract video metadata and available formats from any supported URL.
    Returns title, thumbnail, duration, uploader, and a clean list of formats.

    When the URL is a playlist (or is_playlist=true), returns `is_playlist: true`
    with `count` and `entries` (a flat list of the videos in the playlist).
    """
    validate_url(url)

    try:
        # ── Playlist path ──────────────────────────────────────────
        if is_playlist or looks_like_playlist(url):
            try:
                result = run_ytdlp(
                    [
                        "--dump-json",
                        "--no-download",
                        "--flat-playlist",
                        url,
                    ]
                )
                root = json.loads(result.stdout.strip().split("\n")[0])
            except (RuntimeError, json.JSONDecodeError):
                root = {}

            payload = parse_playlist_info(root, url)
            # Only return the playlist payload when yt-dlp really found entries.
            if payload.get("is_playlist"):
                return payload
            # Otherwise fall through to single-video extraction.

        # ── Single video path ──────────────────────────────────────
        result = run_ytdlp(
            [
                "--dump-json",
                "--no-download",
                "--no-playlist",
                url,
            ]
        )
        data = json.loads(result.stdout.strip().split("\n")[0])

        formats = simplify_formats(data.get("formats") or [])
        best = build_best_format_ids(formats)

        return {
            "success": True,
            "is_playlist": False,
            "id": data.get("id"),
            "title": data.get("title", "Unknown"),
            "duration": data.get("duration"),
            "thumbnail": data.get("thumbnail"),
            "uploader": data.get("uploader") or data.get("channel") or "Unknown",
            "uploader_url": data.get("uploader_url") or data.get("channel_url"),
            "webpage_url": data.get("webpage_url") or url,
            "formats": formats,
            "best_format_id": best["best_video"],
            "best_audio_format_id": best["best_audio"],
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
    url: str = Query(..., description="Video or playlist URL to download"),
    format_id: str = Query("best", description="Format ID to download"),
    is_playlist: bool = Query(
        False, description="Download the whole playlist and return it as a ZIP"
    ),
    limit: int = Query(
        0, ge=0, description="Max videos to download from a playlist (0 = all)"
    ),
):
    """
    Download a video from the given URL in the specified format, streaming the
    file directly to the client as a download attachment.

    When is_playlist=true, downloads every video in the playlist and returns
    them packed in a single ZIP archive.
    """
    validate_url(url)

    # Create a unique session ID for this download
    session_id = str(uuid.uuid4())
    fmt = build_format_selector(format_id)

    # ── Playlist download (multiple videos at once) ────────────────
    if is_playlist:
        work_dir = DOWNLOAD_DIR / session_id
        work_dir.mkdir(parents=True, exist_ok=True)
        zip_path = DOWNLOAD_DIR / f"{session_id}.zip"
        try:
            args = [
                "--format",
                fmt,
                "--output",
                str(
                    work_dir
                    / "%(playlist_index)03d - %(title).120B [%(id)s].%(ext)s"
                ),
                "--merge-output-format",
                "mp4",
            ]
            if limit > 0:
                args += ["--playlist-items", f"1-{limit}"]

            # Playlist downloads can take a long time — give yt-dlp up to
            # 2 hours before declaring the request dead.
            run_ytdlp(args + [url], timeout=7200)

            files = sorted(work_dir.rglob("*"))
            video_files = [f for f in files if f.is_file()]
            if not video_files:
                raise RuntimeError(
                    "No files were downloaded from the playlist. "
                    "The playlist may be empty or private."
                )

            total_size = sum(f.stat().st_size for f in video_files)
            if total_size > MAX_FILE_SIZE:
                shutil.rmtree(work_dir, ignore_errors=True)
                raise HTTPException(
                    status_code=413,
                    detail="Playlist exceeds maximum total size limit",
                )

            # Pack into a ZIP (videos are already compressed — store, don't re-compress)
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zf:
                for f in video_files:
                    zf.write(f, f.name)

            shutil.rmtree(work_dir, ignore_errors=True)
            cleanup_old_files()

            return FileResponse(
                path=str(zip_path),
                filename=f"vidfetch_playlist_{sanitize_filename(session_id)}.zip",
                media_type="application/zip",
                headers={
                    "X-Session-Id": session_id,
                    "X-File-Count": str(len(video_files)),
                    "X-File-Size": str(total_size),
                },
            )
        except HTTPException:
            raise
        except RuntimeError as e:
            shutil.rmtree(work_dir, ignore_errors=True)
            raise HTTPException(status_code=422, detail=str(e))
        except Exception as e:
            shutil.rmtree(work_dir, ignore_errors=True)
            raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")

    # ── Single video download ──────────────────────────────────────
    output_template = str(DOWNLOAD_DIR / f"{session_id}.%(ext)s")

    try:
        ydl_opts = [
            "--format",
            fmt,
            "--output",
            output_template,
            "--no-playlist",
            "--merge-output-format",
            "mp4",
        ]

        run_ytdlp(ydl_opts + [url], timeout=3600)

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
