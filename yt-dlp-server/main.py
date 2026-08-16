"""
VidFetch yt-dlp Server

Self-hosted video download API powered by yt-dlp. Supports 1000+ sites
(YouTube, TikTok, Twitter/X, Instagram, Vimeo, Facebook, ...).

Endpoints
    GET /api/health
    GET /api/info?url=<url>[&is_playlist=true]
    GET /api/download?url=<url>[&format_id=best][&is_playlist=true][&limit=N]

Environment variables
    HOST / PORT                Bind address and port (default 0.0.0.0:8080)
    DOWNLOAD_DIR               Temp directory for downloads (default /tmp/vidfetch-downloads)
    CLEANUP_AGE_SECONDS        Delete finished files older than this (default 1800)
    MAX_FILE_SIZE              Max single file size in bytes (default 2 GiB)
    YTDLP_COOKIES_FILE         Path to a Netscape-format cookies.txt (optional)
    YTDLP_PO_TOKEN_PROVIDER    URL of a bgutil-ytdlp-pot-provider server (optional;
                               requires the yt-dlp-get-pot plugin, which reads this
                               variable itself)
    YTDLP_PLAYER_CLIENT        YouTube player client override, e.g. "tv" (optional)

The server also auto-detects a `cookies/youtube.txt` file next to main.py
and uses it when YTDLP_COOKIES_FILE is not set.
"""

import os
import re
import shutil
import tempfile
import time
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

try:
    import yt_dlp
except ImportError:  # pragma: no cover
    yt_dlp = None

APP_NAME = "VidFetch"
DOWNLOAD_DIR = Path(os.environ.get("DOWNLOAD_DIR", "/tmp/vidfetch-downloads"))
CLEANUP_AGE_SECONDS = int(os.environ.get("CLEANUP_AGE_SECONDS", "1800"))
MAX_FILE_SIZE = int(os.environ.get("MAX_FILE_SIZE", str(2 * 1024 ** 3)))

# Cheap URL heuristic for playlists (yt-dlp's own response is authoritative).
PLAYLIST_URL_RE = re.compile(r"(?:[?&]list=|/playlist(?:[/?]|$))")


@asynccontextmanager
async def lifespan(_: FastAPI):
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    _cleanup_old_files()
    yield


app = FastAPI(title=f"{APP_NAME} yt-dlp API", version="1.0.0", lifespan=lifespan)

# The web app fetches /api/info cross-origin (the server is a separate
# deployment). No credentials are used, so a permissive origin list is safe.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ── yt-dlp helpers ────────────────────────────────────────────────────

def _cookiefile() -> Optional[str]:
    """Explicit YTDLP_COOKIES_FILE, or an auto-detected cookies/youtube.txt."""
    path = (os.environ.get("YTDLP_COOKIES_FILE") or "").strip()
    if path and os.path.isfile(path):
        return path
    auto = Path(__file__).resolve().parent / "cookies" / "youtube.txt"
    if auto.is_file():
        return str(auto)
    return None


def _base_opts() -> dict:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": False,
    }
    cookies = _cookiefile()
    if cookies:
        opts["cookiefile"] = cookies
    player_client = (os.environ.get("YTDLP_PLAYER_CLIENT") or "").strip()
    if player_client:
        opts["extractor_args"] = {"youtube": {"player_client": [player_client]}}
    # YTDLP_PO_TOKEN_PROVIDER is consumed by the bgutil-ytdlp-get-pot plugin
    # (https://github.com/Brainicism/bgutil-ytdlp-pot-provider) automatically.
    return opts


def _ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _absolutize(raw: str, base_url: str) -> str:
    """Flat playlist entries often carry relative URLs (e.g. /watch?v=...)."""
    if not raw:
        return raw
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    if raw.startswith("/"):
        m = re.match(r"^(https?://[^/]+)", base_url)
        if m:
            return m.group(1) + raw
    return raw


def _friendly_error(exc: Exception) -> str:
    """Strip yt-dlp's noisy ERROR: prefix and cap the length."""
    msg = str(exc)
    m = re.search(r"ERROR:\s*(.+)", msg)
    if m:
        msg = m.group(1).strip()
    if len(msg) > 500:
        msg = msg[:500] + "..."
    return msg or exc.__class__.__name__


def _cleanup_old_files() -> None:
    if not DOWNLOAD_DIR.is_dir():
        return
    cutoff = time.time() - CLEANUP_AGE_SECONDS
    for p in DOWNLOAD_DIR.iterdir():
        try:
            if p.is_file() and p.stat().st_mtime < cutoff:
                p.unlink(missing_ok=True)
        except OSError:
            pass


# ── Info payload builders ─────────────────────────────────────────────

def _format_entry(f: dict) -> dict:
    height = f.get("height")
    width = f.get("width")
    vcodec = f.get("vcodec")
    acodec = f.get("acodec")
    if vcodec == "none":
        vcodec = None
    if acodec == "none":
        acodec = None
    resolution = ""
    if height:
        resolution = f"{width or '?'}x{height}"
    else:
        note = f.get("format_note")
        if note:
            resolution = str(note)
    return {
        "format_id": str(f.get("format_id") or ""),
        "ext": f.get("ext") or "",
        "resolution": resolution,
        "filesize": f.get("filesize") or f.get("filesize_approx"),
        "vcodec": vcodec,
        "acodec": acodec,
        "fps": f.get("fps"),
        "tbr": f.get("tbr"),
    }


def _curate_formats(formats: list) -> list:
    """Drop unusable formats (storyboards, none/none) and cap the list."""
    out: list = []
    seen: set = set()
    for f in formats or []:
        fid = str(f.get("format_id") or "")
        if not fid:
            continue
        if fid.startswith("sb"):
            continue
        note = str(f.get("format_note") or "").lower()
        if note in {"storyboard", "mhtml", "jpeg", "none"}:
            continue
        if f.get("vcodec") in (None, "none") and f.get("acodec") in (None, "none"):
            continue
        key = (fid, f.get("ext"))
        if key in seen:
            continue
        seen.add(key)
        out.append(_format_entry(f))
    return out[:60]


def _best_format_id(info: dict) -> tuple[str, Optional[str]]:
    """Best video+audio combo (e.g. '137+140'), or the best single format."""
    formats = info.get("formats") or []

    def is_video(f: dict) -> bool:
        return f.get("vcodec") not in (None, "none")

    def is_audio(f: dict) -> bool:
        return f.get("acodec") not in (None, "none")

    video_only = [f for f in formats if is_video(f) and not is_audio(f)]
    audio_only = [f for f in formats if is_audio(f) and not is_video(f)]
    combined = [f for f in formats if is_video(f) and is_audio(f)]

    def top(items: list) -> dict:
        return max(
            items,
            key=lambda f: (
                f.get("height") or 0,
                f.get("tbr") or 0,
                f.get("abr") or 0,
            ),
        )

    if video_only and audio_only:
        best_video = top(video_only)
        best_audio = top(audio_only)
        return f"{best_video['format_id']}+{best_audio['format_id']}", str(best_audio["format_id"])
    if combined:
        best = top(combined)
        return str(best["format_id"]), None
    if video_only:
        return str(top(video_only)["format_id"]), None
    if audio_only:
        return str(top(audio_only)["format_id"]), str(top(audio_only)["format_id"])
    return "best", None


def _entry_payload(entry: dict, base_url: str) -> dict:
    thumbs = entry.get("thumbnails") or []
    thumb = entry.get("thumbnail") or (thumbs[0].get("url") if thumbs else None)
    return {
        "id": entry.get("id"),
        "title": entry.get("title") or "",
        "url": _absolutize(
            entry.get("webpage_url") or entry.get("url") or "", base_url
        ),
        "duration": entry.get("duration"),
        "thumbnail": thumb,
    }


def _info_payload(info: dict, base_url: str) -> dict:
    thumbnails = info.get("thumbnails") or []
    best_id, best_audio_id = _best_format_id(info)
    return {
        "success": True,
        "id": info.get("id") or "",
        "title": info.get("title") or "Untitled",
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail")
        or (thumbnails[0].get("url") if thumbnails else None),
        "uploader": info.get("uploader") or info.get("channel") or "",
        "uploader_url": info.get("uploader_url") or info.get("channel_url"),
        "webpage_url": info.get("webpage_url") or base_url,
        "formats": _curate_formats(info.get("formats") or []),
        "best_format_id": best_id,
        "best_audio_format_id": best_audio_id,
        "ffmpeg_available": _ffmpeg_available(),
        "is_playlist": False,
    }


# ── Extraction ────────────────────────────────────────────────────────

def _extract_flat(url: str) -> dict:
    opts = _base_opts()
    opts.update({"skip_download": True, "extract_flat": "in_playlist"})
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=False)


def _extract_single(url: str) -> dict:
    opts = _base_opts()
    opts.update({"skip_download": True, "noplaylist": True})
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=False)


# ── API routes ────────────────────────────────────────────────────────

@app.get("/")
def root() -> dict:
    return {"service": APP_NAME, "docs": "/docs", "health": "/api/health"}


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": APP_NAME,
        "yt_dlp_installed": yt_dlp is not None,
        "ffmpeg_available": _ffmpeg_available(),
    }


@app.get("/api/info")
def api_info(
    url: str = Query(...),
    is_playlist: Optional[str] = Query(None),
) -> dict:
    if yt_dlp is None:
        raise HTTPException(
            500, "yt-dlp is not installed on this server. Run: pip install -r requirements.txt"
        )

    playlist_hint = is_playlist is not None and is_playlist.lower() in {"1", "true", "yes", "on"}
    try:
        # Playlist mode: fetch the entry list fast (flat extraction), so the
        # app can show every video and offer "Download all".
        if playlist_hint or PLAYLIST_URL_RE.search(url):
            info = _extract_flat(url)
            entries = [e for e in (info.get("entries") or []) if e and e.get("id")]
            if entries:
                payload = _info_payload(info, url)
                payload.update(
                    {
                        "is_playlist": True,
                        "count": info.get("playlist_count") or len(entries),
                        "entries": [_entry_payload(e, url) for e in entries],
                        "formats": [],
                        "best_format_id": "best",
                        "best_audio_format_id": None,
                        "duration": None,
                    }
                )
                return payload
            # URL hinted at a playlist but yt-dlp disagrees → single video.
        info = _extract_single(url)
        return _info_payload(info, url)
    except Exception as exc:  # noqa: BLE001 - surface any extractor failure
        raise HTTPException(422, _friendly_error(exc))


def _run_ytdlp(
    url: str,
    format_id: str,
    outtmpl: Path,
    playlist: bool = False,
    limit: int = 0,
) -> None:
    opts = _base_opts()
    opts.update(
        {
            "format": format_id or "best",
            "outtmpl": str(outtmpl),
            "noplaylist": not playlist,
        }
    )
    if playlist and limit and limit > 0:
        opts["playlist_items"] = f"1-{limit}"
    if "+" in (format_id or ""):
        # Video+audio combo — merge into an mp4 container (needs ffmpeg).
        opts["merge_output_format"] = "mp4"
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])


def _finished_files(folder: Path) -> list:
    return [
        p
        for p in folder.iterdir()
        if p.is_file() and not p.name.endswith((".part", ".ytdl", ".temp"))
    ]


def _download_single(url: str, format_id: str, workdir: Path, background_tasks: BackgroundTasks):
    _run_ytdlp(url, format_id, workdir / "%(title).100B [%(id)s].%(ext)s")
    files = _finished_files(workdir)
    if not files:
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(422, "yt-dlp finished without producing a file")
    target = files[0]
    size = target.stat().st_size
    if size > MAX_FILE_SIZE:
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(
            413,
            f"File is {size / 1024 / 1024:.0f} MB — over the "
            f"{MAX_FILE_SIZE / 1024 / 1024:.0f} MB server limit",
        )
    background_tasks.add_task(shutil.rmtree, workdir, ignore_errors=True)
    return FileResponse(
        str(target), media_type="application/octet-stream", filename=target.name
    )


def _download_playlist(
    url: str, format_id: str, limit: int, workdir: Path, background_tasks: BackgroundTasks
):
    videos_dir = workdir / "videos"
    videos_dir.mkdir()
    _run_ytdlp(
        url,
        format_id,
        videos_dir / "%(playlist_index)03d - %(title).80B [%(id)s].%(ext)s",
        playlist=True,
        limit=limit,
    )
    files = sorted(_finished_files(videos_dir))
    if not files:
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(422, "yt-dlp finished without producing any files")
    zip_path = workdir / "playlist.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, f in enumerate(files, 1):
            zf.write(f, f"{i:03d} - {f.name}")
    background_tasks.add_task(shutil.rmtree, workdir, ignore_errors=True)
    return FileResponse(str(zip_path), media_type="application/zip", filename="playlist.zip")


@app.get("/api/download")
def api_download(
    url: str = Query(...),
    format_id: str = Query("best"),
    is_playlist: Optional[str] = Query(None),
    limit: int = Query(0, ge=0),
    background_tasks: BackgroundTasks = None,  # type: ignore[assignment]  # FastAPI injects it
):
    if yt_dlp is None:
        raise HTTPException(
            500, "yt-dlp is not installed on this server. Run: pip install -r requirements.txt"
        )

    _cleanup_old_files()
    playlist = is_playlist is not None and is_playlist.lower() in {"1", "true", "yes", "on"}
    workdir = Path(tempfile.mkdtemp(prefix="vidfetch-", dir=DOWNLOAD_DIR))
    try:
        if playlist:
            return _download_playlist(url, format_id, limit, workdir, background_tasks)
        return _download_single(url, format_id, workdir, background_tasks)
    except HTTPException:
        shutil.rmtree(workdir, ignore_errors=True)
        raise
    except Exception as exc:  # noqa: BLE001 - surface any download failure
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(422, _friendly_error(exc))


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8080"))
    uvicorn.run(app, host=host, port=port)
