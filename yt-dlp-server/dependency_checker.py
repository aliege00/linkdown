"""
FFmpeg Dependency Checker
=========================

Checks for FFmpeg on startup and downloads a static build if missing.

Designed for the Desktop (EXE) version where FFmpeg may not be installed
system-wide. Runs entirely in the background — never blocks the UI or
the HTTP server.

Architecture:
  1. On startup, search known paths for ffmpeg binary
  2. If found → log version and continue
  3. If missing → download latest static build in background thread
  4. Extract to app-local bin directory
  5. Update PATH for the current process

Supported platforms:
  - Windows: gyan.dev or BtbN GitHub builds (ffmpeg.exe)
  - macOS: evermeet.cx or official builds (ffmpeg)
  - Linux: John Van Sickle static builds (ffmpeg)

Environment variables:
  FFMPEG_PATH
      Override: full path to ffmpeg binary (skip auto-detection)
  LINKDOWN_BIN_DIR
      Override: where to store downloaded binaries
      (default: %AppData%/LinkDown/bin on Windows, ~/.linkdown/bin on others)
"""

from __future__ import annotations

import json
import logging
import os
import platform
import shutil
import stat
import subprocess
import sys
import threading
import time
import zipfile
from pathlib import Path
from typing import Optional
from urllib.request import Request, urlopen

logger = logging.getLogger("vidfetch.deps")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

FFMPEG_URLS = {
    "Windows": "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    "Darwin": "https://evermeet.cx/ffmpeg/getrelease/zip",
    "Linux": "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz",
}

# Known system paths to search for ffmpeg
SYSTEM_SEARCH_PATHS = {
    "Windows": [
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg.exe"),
        os.path.expandvars(r"%USERPROFILE%\scoop\shims\ffmpeg.exe"),
        shutil.which("ffmpeg") or "",
    ],
    "Darwin": [
        "/usr/local/bin/ffmpeg",
        "/opt/homebrew/bin/ffmpeg",
        shutil.which("ffmpeg") or "",
    ],
    "Linux": [
        "/usr/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/snap/bin/ffmpeg",
        shutil.which("ffmpeg") or "",
    ],
}

DEFAULT_BIN_DIR = {
    "Windows": os.path.expandvars(r"%APPDATA%\LinkDown\bin"),
    "Darwin": os.path.expanduser("~/.linkdown/bin"),
    "Linux": os.path.expanduser("~/.linkdown/bin"),
}


# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------

def _platform_key() -> str:
    system = platform.system()
    return system  # "Windows", "Darwin", "Linux"


def _get_bin_dir() -> str:
    return os.environ.get("LINKDOWN_BIN_DIR", DEFAULT_BIN_DIR.get(_platform_key(), "/tmp/linkdown-bin"))


def _ffmpeg_filename() -> str:
    return "ffmpeg.exe" if _platform_key() == "Windows" else "ffmpeg"


# ---------------------------------------------------------------------------
# FFmpeg detection
# ---------------------------------------------------------------------------

def find_ffmpeg() -> Optional[str]:
    """
    Search for ffmpeg binary in known locations.

    Returns the full path if found, None otherwise.
    """
    # 1. Check environment override
    env_path = os.environ.get("FFMPEG_PATH", "")
    if env_path and os.path.isfile(env_path):
        logger.info("FFmpeg found via FFMPEG_PATH: %s", env_path)
        return env_path

    # 2. Check app-local bin directory
    local_path = os.path.join(_get_bin_dir(), _ffmpeg_filename())
    if os.path.isfile(local_path):
        logger.info("FFmpeg found in app directory: %s", local_path)
        return local_path

    # 3. Check system paths
    key = _platform_key()
    for path in SYSTEM_SEARCH_PATHS.get(key, []):
        if path and os.path.isfile(path):
            logger.info("FFmpeg found in system path: %s", path)
            return path

    # 4. Last resort: try `which` / `where`
    found = shutil.which("ffmpeg")
    if found:
        logger.info("FFmpeg found via which: %s", found)
        return found

    return None


def get_ffmpeg_version(ffmpeg_path: str) -> Optional[str]:
    """Get FFmpeg version string."""
    try:
        result = subprocess.run(
            [ffmpeg_path, "-version"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        first_line = result.stdout.split("\n")[0]
        # Extract version like "ffmpeg version 6.1.1"
        parts = first_line.split()
        if len(parts) >= 3:
            return parts[2]
        return first_line
    except Exception:
        return None


def is_ffmpeg_available() -> bool:
    """Quick check: is FFmpeg accessible?"""
    return find_ffmpeg() is not None


# ---------------------------------------------------------------------------
# FFmpeg download
# ---------------------------------------------------------------------------

def _download_file(url: str, dest: str, timeout: int = 300) -> bool:
    """Download a file with progress logging."""
    logger.info("Downloading: %s → %s", url, dest)
    try:
        req = Request(url, headers={"User-Agent": "LinkDown/1.0"})
        with urlopen(req, timeout=timeout) as resp:
            total = int(resp.headers.get("Content-Length", 0))
            downloaded = 0
            chunk_size = 256 * 1024

            with open(dest, "wb") as f:
                while True:
                    chunk = resp.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total > 0 and downloaded % (5 * chunk_size) == 0:
                        pct = downloaded / total * 100
                        logger.info("Download progress: %.1f%%", pct)

        logger.info("Download complete: %s (%d bytes)", dest, downloaded)
        return True
    except Exception as exc:
        logger.error("Download failed: %s", exc)
        return False


def _extract_ffmpeg(archive_path: str, bin_dir: str) -> Optional[str]:
    """Extract ffmpeg binary from archive."""
    ffmpeg_name = _ffmpeg_filename()
    platform_key = _platform_key()

    try:
        if platform_key == "Windows":
            # ZIP archive
            with zipfile.ZipFile(archive_path, "r") as zf:
                # Find ffmpeg.exe inside the archive
                for name in zf.namelist():
                    if name.endswith("ffmpeg.exe") and "bin" in name.lower():
                        # Extract to bin_dir
                        zf.extract(name, bin_dir)
                        extracted = os.path.join(bin_dir, name)
                        # Move to bin_dir root
                        final_path = os.path.join(bin_dir, ffmpeg_name)
                        if extracted != final_path:
                            shutil.move(extracted, final_path)
                        os.chmod(final_path, stat.S_IRWXU)
                        logger.info("Extracted ffmpeg.exe to %s", final_path)
                        return final_path

                # Fallback: look for any ffmpeg.exe
                for name in zf.namelist():
                    if name.lower().endswith("ffmpeg.exe"):
                        zf.extract(name, bin_dir)
                        extracted = os.path.join(bin_dir, name)
                        final_path = os.path.join(bin_dir, ffmpeg_name)
                        if extracted != final_path:
                            shutil.move(extracted, final_path)
                        os.chmod(final_path, stat.S_IRWXU)
                        return final_path

        elif platform_key == "Darwin":
            # ZIP archive from evermeet
            with zipfile.ZipFile(archive_path, "r") as zf:
                zf.extractall(bin_dir)
                final_path = os.path.join(bin_dir, ffmpeg_name)
                os.chmod(final_path, stat.S_IRWXU)
                logger.info("Extracted ffmpeg to %s", final_path)
                return final_path

        elif platform_key == "Linux":
            # tar.xz archive — need to handle differently
            import tarfile
            with tarfile.open(archive_path, "r:xz") as tf:
                for member in tf.getmembers():
                    if member.name.endswith("ffmpeg") and member.isfile():
                        member.name = ffmpeg_name  # Rename to just "ffmpeg"
                        tf.extract(member, bin_dir)
                        final_path = os.path.join(bin_dir, ffmpeg_name)
                        os.chmod(final_path, stat.S_IRWXU)
                        logger.info("Extracted ffmpeg to %s", final_path)
                        return final_path

    except Exception as exc:
        logger.error("Extraction failed: %s", exc)
        return None

    return None


def download_ffmpeg() -> Optional[str]:
    """
    Download and install FFmpeg for the current platform.

    Returns the path to the installed ffmpeg binary, or None on failure.
    """
    key = _platform_key()
    url = FFMPEG_URLS.get(key)
    if not url:
        logger.error("No FFmpeg download URL for platform: %s", key)
        return None

    bin_dir = _get_bin_dir()
    os.makedirs(bin_dir, exist_ok=True)

    # Download to temp file
    ext = ".zip" if key in ("Windows", "Darwin") else ".tar.xz"
    temp_file = os.path.join(bin_dir, f"ffmpeg_download{ext}")

    try:
        if not _download_file(url, temp_file, timeout=300):
            return None

        # Extract
        ffmpeg_path = _extract_ffmpeg(temp_file, bin_dir)

        # Clean up archive
        try:
            os.remove(temp_file)
        except OSError:
            pass

        if ffmpeg_path:
            # Add to current process PATH
            _add_to_path(bin_dir)
            logger.info("FFmpeg installed successfully: %s", ffmpeg_path)

        return ffmpeg_path

    except Exception as exc:
        logger.error("FFmpeg installation failed: %s", exc)
        # Clean up partial download
        try:
            os.remove(temp_file)
        except OSError:
            pass
        return None


# ---------------------------------------------------------------------------
# PATH management
# ---------------------------------------------------------------------------

def _add_to_path(directory: str):
    """Add a directory to the current process PATH."""
    current = os.environ.get("PATH", "")
    if directory not in current:
        sep = ";" if _platform_key() == "Windows" else ":"
        os.environ["PATH"] = directory + sep + current
        logger.info("Added to PATH: %s", directory)


def add_to_system_path_permanent(directory: str) -> bool:
    """
    Add directory to the user's permanent PATH (Windows only).
    
    On Windows, this modifies the user's registry PATH.
    On other platforms, this is a no-op (PATH is managed by shell profile).
    
    Returns True if successful.
    """
    if _platform_key() != "Windows":
        logger.info("Permanent PATH update is automatic on non-Windows platforms")
        return True

    try:
        import winreg
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Environment",
            0,
            winreg.KEY_ALL_ACCESS,
        )
        current_path, _ = winreg.QueryValueEx(key, "Path")
        
        if directory not in current_path:
            new_path = current_path + ";" + directory
            winreg.SetValueEx(key, "Path", 0, winreg.REG_EXPAND_SZ, new_path)
            logger.info("Added to permanent PATH: %s", directory)
            
            # Notify other processes (SendMessageTimeout with WM_SETTINGCHANGE)
            try:
                import ctypes
                HWND_BROADCAST = 0xFFFF
                WM_SETTINGCHANGE = 0x001A
                SMTO_ABORTIFHUNG = 0x0002
                ctypes.windll.user32.SendMessageTimeoutA(
                    HWND_BROADCAST, WM_SETTINGCHANGE, 0,
                    "Environment", SMTO_ABORTIFHUNG, 5000, None,
                )
            except Exception:
                pass  # Best effort — not critical
        
        winreg.CloseKey(key)
        return True
    except ImportError:
        logger.warning("winreg not available — cannot update permanent PATH")
        return False
    except Exception as exc:
        logger.error("Failed to update permanent PATH: %s", exc)
        return False


# ---------------------------------------------------------------------------
# Background startup check
# ---------------------------------------------------------------------------

def startup_check() -> Optional[str]:
    """
    Run FFmpeg check on startup.
    
    1. Check if ffmpeg is already available
    2. If not, download in background thread
    3. Return the path if already available, None if downloading
    
    This function is non-blocking.
    """
    # Quick check first
    ffmpeg_path = find_ffmpeg()
    if ffmpeg_path:
        version = get_ffmpeg_version(ffmpeg_path)
        logger.info("FFmpeg available: %s (version: %s)", ffmpeg_path, version or "unknown")
        return ffmpeg_path

    # Not found — download in background
    logger.info("FFmpeg not found — starting background download...")
    
    def _bg_download():
        path = download_ffmpeg()
        if path:
            # Also update permanent PATH on Windows
            bin_dir = _get_bin_dir()
            add_to_system_path_permanent(bin_dir)
            logger.info("FFmpeg background installation complete: %s", path)
        else:
            logger.error("FFmpeg background installation failed")

    thread = threading.Thread(target=_bg_download, daemon=True, name="ffmpeg-downloader")
    thread.start()
    
    return None


# ---------------------------------------------------------------------------
# Health check (used by /api/health endpoint)
# ---------------------------------------------------------------------------

def get_dependency_status() -> dict:
    """
    Return dependency status for the health endpoint.
    
    Example::
        {
            "ffmpeg": {
                "available": true,
                "path": "/usr/bin/ffmpeg",
                "version": "6.1.1"
            }
        }
    """
    ffmpeg_path = find_ffmpeg()
    if ffmpeg_path:
        return {
            "available": True,
            "path": ffmpeg_path,
            "version": get_ffmpeg_version(ffmpeg_path),
        }
    return {
        "available": False,
        "path": None,
        "version": None,
    }
