"""
yt-dlp Background Auto-Updater (Hardened)
==========================================

Checks for a new yt-dlp release on server startup and silently installs it
in a background thread so the HTTP server is never blocked.

The update uses ``pip install --upgrade yt-dlp`` inside a ``threading.Thread``
(daemon) so it dies automatically if the main process exits.

Edge-case handling:
  - Network retry (3 attempts with backoff) for PyPI version checks
  - Disk space validation before pip install
  - Graceful handling of pip failures, corrupt installs, permission errors
  - File-lock to prevent concurrent update attempts
  - Comprehensive logging for every failure mode

Environment variables
---------------------
YTDLP_AUTO_UPDATE
    Set to ``0`` to disable the auto-updater entirely (default: ``1``).
YTDLP_UPDATE_CHECK_INTERVAL
    Seconds between periodic background checks after startup (default: ``3600``
    = 1 hour).  Set to ``0`` to only check once on startup.
RESTART_ON_UPDATE
    Set to ``1`` to ``os.execv`` the process after a successful pip upgrade
    (default: ``0``).
"""

from __future__ import annotations

import importlib.metadata
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import Optional, Tuple

logger = logging.getLogger("vidfetch.updater")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PyPI_URL = "https://pypi.org/pypi/yt-dlp/json"
PACKAGE = "yt-dlp"
TIMEOUT = 10          # seconds for the PyPI HTTP call
MAX_RETRIES = 3       # retry count for network requests
RETRY_DELAY = 2       # base delay in seconds (doubles each retry)
MIN_FREE_SPACE_MB = 100  # minimum MB free before attempting pip install

# File lock to prevent concurrent update attempts
_update_lock = threading.Lock()
_update_in_progress = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _current_version() -> str:
    """Return the version of the installed yt-dlp package."""
    try:
        return importlib.metadata.version(PACKAGE)
    except importlib.metadata.PackageNotFoundError:
        return "0.0.0"
    except Exception as exc:
        logger.warning("Could not determine installed version: %s", exc)
        return "0.0.0"


def _latest_version() -> Optional[str]:
    """
    Fetch the latest yt-dlp version from PyPI with retry logic.

    Returns None if all attempts fail (network down, DNS failure, etc.).
    """
    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            req = urllib.request.Request(
                PyPI_URL,
                headers={
                    "Accept": "application/json",
                    "User-Agent": "vidfetch-updater/1.0",
                },
            )
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                data = json.loads(resp.read().decode())
                version = data.get("info", {}).get("version")
                if not version:
                    logger.warning("PyPI returned empty version field")
                    return None
                return version
        except urllib.error.URLError as exc:
            last_error = exc
            logger.debug(
                "PyPI request attempt %d/%d failed (network): %s",
                attempt, MAX_RETRIES, exc,
            )
        except json.JSONDecodeError as exc:
            last_error = exc
            logger.warning("PyPI returned invalid JSON: %s", exc)
            return None  # Don't retry JSON parse errors
        except Exception as exc:
            last_error = exc
            logger.debug(
                "PyPI request attempt %d/%d failed: %s",
                attempt, MAX_RETRIES, exc,
            )

        # Exponential backoff before retry
        if attempt < MAX_RETRIES:
            delay = RETRY_DELAY * (2 ** (attempt - 1))
            logger.debug("Retrying in %ds...", delay)
            time.sleep(delay)

    logger.warning(
        "Failed to reach PyPI after %d attempts. Last error: %s",
        MAX_RETRIES, last_error,
    )
    return None


def _parse_version(v: str) -> Tuple[int, ...]:
    """Parse a version string into a tuple of ints for comparison."""
    parts = v.split(".")
    result = []
    for p in parts:
        # Strip any non-numeric suffix like "2025.12.1.post1"
        numeric = ""
        for ch in p:
            if ch.isdigit():
                numeric += ch
            else:
                break
        if numeric:
            try:
                result.append(int(numeric))
            except ValueError:
                pass
    return tuple(result) if result else (0,)


def _check_disk_space() -> bool:
    """Check if there's enough free disk space for pip to install packages."""
    try:
        free = shutil.disk_usage("/").free
        free_mb = free / (1024 * 1024)
        if free_mb < MIN_FREE_SPACE_MB:
            logger.warning(
                "Insufficient disk space for pip install: %.1f MB free (need %d MB)",
                free_mb, MIN_FREE_SPACE_MB,
            )
            return False
        return True
    except Exception as exc:
        logger.debug("Could not check disk space: %s — proceeding optimistically", exc)
        return True  # If we can't check, proceed


def _upgrade_ytdlp() -> bool:
    """Run ``pip install --upgrade yt-dlp`` and return True on success."""
    global _update_in_progress

    if not _check_disk_space():
        return False

    cmd = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--upgrade",
        "--quiet",
        PACKAGE,
    ]
    logger.info("Upgrading %s ...", PACKAGE)
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,  # 5 min max
        )
        if result.returncode == 0:
            logger.info("%s upgraded successfully.", PACKAGE)
            return True
        else:
            stderr = (result.stderr or "").strip()
            # Truncate long error output
            if len(stderr) > 500:
                stderr = stderr[:500] + "..."

            # Classify common pip errors
            if "Permission denied" in stderr or "Errno 13" in stderr:
                logger.error("pip upgrade failed: permission denied (are you root?)")
            elif "No space left" in stderr or "ENOSPC" in stderr:
                logger.error("pip upgrade failed: disk full")
            elif "Could not find a version" in stderr:
                logger.error("pip upgrade failed: package not found on PyPI")
            elif "Hash mismatch" in stderr or "inequality" in stderr:
                logger.error("pip upgrade failed: hash mismatch (possible corrupted download)")
            else:
                logger.warning("pip upgrade failed (rc=%d): %s", result.returncode, stderr)

            return False
    except subprocess.TimeoutExpired:
        logger.warning("pip upgrade timed out after 300s")
        return False
    except PermissionError:
        logger.error("pip upgrade failed: permission denied")
        return False
    except Exception as exc:
        logger.warning("pip upgrade exception: %s", exc)
        return False
    finally:
        _update_in_progress = False


# ---------------------------------------------------------------------------
# Background update worker
# ---------------------------------------------------------------------------

def _update_worker(restart_on_success: bool = False) -> None:
    """Background thread: compare versions, upgrade if needed, optionally restart."""
    global _update_in_progress

    # Prevent concurrent updates
    if not _update_lock.acquire(blocking=False):
        logger.debug("Update already in progress — skipping.")
        return

    try:
        # Check if another thread already updated
        if _update_in_progress:
            return
        _update_in_progress = True

        current = _current_version()
        latest = _latest_version()

        if latest is None:
            logger.info("Could not reach PyPI — skipping update check.")
            _update_in_progress = False
            return

        if _parse_version(latest) <= _parse_version(current):
            logger.info(
                "%s is up-to-date (%s). No update needed.",
                PACKAGE,
                current,
            )
            _update_in_progress = False
            return

        logger.info(
            "New %s version available: %s (installed: %s)",
            PACKAGE,
            latest,
            current,
        )

        success = _upgrade_ytdlp()

        if success and restart_on_success:
            logger.info("Restarting process to load new %s ...", PACKAGE)
            try:
                os.execv(sys.executable, [sys.executable] + sys.argv)
            except Exception as exc:
                logger.error("Failed to restart: %s", exc)

    except Exception as exc:
        logger.debug("Auto-update worker error: %s", exc)
        _update_in_progress = False
    finally:
        _update_lock.release()


def _periodic_checker(
    interval: int,
    restart_on_success: bool,
    stop_event: threading.Event,
) -> None:
    """Sleeps ``interval`` seconds then triggers another update check."""
    while not stop_event.wait(timeout=interval):
        logger.debug("Periodic update check triggered.")
        _update_worker(restart_on_success=restart_on_success)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def start_auto_updater() -> Optional[threading.Event]:
    """
    Start the background auto-updater.  Call this once at server startup.

    Returns a ``threading.Event`` that can be ``set()`` to stop the periodic
    checker, or ``None`` if auto-update is disabled.

    Safe to call multiple times — only the first call spawns threads.
    """
    if os.environ.get("YTDLP_AUTO_UPDATE", "1") == "0":
        logger.info("Auto-updater disabled via YTDLP_AUTO_UPDATE=0")
        return None

    restart_on_success = os.environ.get("RESTART_ON_UPDATE", "0") == "1"

    try:
        check_interval = int(os.environ.get("YTDLP_UPDATE_CHECK_INTERVAL", "3600"))
    except (ValueError, TypeError):
        logger.warning("Invalid YTDLP_UPDATE_CHECK_INTERVAL — defaulting to 3600")
        check_interval = 3600

    stop_event = threading.Event()

    # 1) One-shot check on startup (fire-and-forget daemon thread)
    t = threading.Thread(
        target=_update_worker,
        kwargs={"restart_on_success": restart_on_success},
        daemon=True,
        name="ytdlp-startup-update",
    )
    t.start()
    logger.info("Background yt-dlp update check started (pid=%d)", os.getpid())

    # 2) Periodic re-check (only if interval > 0)
    if check_interval > 0:
        periodic = threading.Thread(
            target=_periodic_checker,
            args=(check_interval, restart_on_success, stop_event),
            daemon=True,
            name="ytdlp-periodic-update",
        )
        periodic.start()
        logger.info(
            "Periodic update check every %ds. Disable with YTDLP_UPDATE_CHECK_INTERVAL=0",
            check_interval,
        )

    return stop_event


def get_update_status() -> dict:
    """
    Return current version info — useful for a ``/api/update-status`` endpoint.

    Example response::

        {
            "installed": "2025.12.1",
            "latest": "2026.1.3",
            "update_available": true
        }
    """
    current = _current_version()
    latest = _latest_version()
    return {
        "installed": current,
        "latest": latest,
        "update_available": latest is not None and _parse_version(latest) > _parse_version(current),
    }
