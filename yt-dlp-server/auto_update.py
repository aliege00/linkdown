"""
yt-dlp Background Auto-Updater
===============================

Checks for a new yt-dlp release on server startup and silently installs it
in a background thread so the HTTP server is never blocked.

The update uses ``pip install --upgrade yt-dlp`` inside a ``threading.Thread``
(daemon) so it dies automatically if the main process exits.

How it works
------------
1.  On ``start_auto_updater()`` the installed version is compared to the latest
    PyPI version (``importlib.metadata`` vs ``https://pypi.org/pypi/yt-dlp/json``).
2.  If the installed version is older, ``pip install --upgrade yt-dlp`` runs in
    a daemon thread.
3.  A second thread waits for pip to finish, then restarts the process via
    ``os.execv`` so the new binary is loaded.  This is optional and only
    triggered when ``RESTART_ON_UPDATE=1`` (default: off — most server
    platforms re-deploy automatically).

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
import subprocess
import sys
import threading
import time
import urllib.request
from typing import Optional, Tuple

logger = logging.getLogger("vidfetch.updater")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PyPI_URL = "https://pypi.org/pypi/yt-dlp/json"
PACKAGE = "yt-dlp"
TIMEOUT = 10  # seconds for the PyPI HTTP call


def _current_version() -> str:
    """Return the version of the installed yt-dlp package."""
    try:
        return importlib.metadata.version(PACKAGE)
    except importlib.metadata.PackageNotFoundError:
        return "0.0.0"


def _latest_version() -> Optional[str]:
    """Fetch the latest yt-dlp version from PyPI (no install needed)."""
    try:
        req = urllib.request.Request(
            PyPI_URL,
            headers={"Accept": "application/json", "User-Agent": "vidfetch-updater/1.0"},
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode())
            return data["info"]["version"]
    except Exception as exc:
        logger.debug("Failed to fetch latest version from PyPI: %s", exc)
        return None


def _parse_version(v: str) -> Tuple[int, ...]:
    """Parse a version string into a tuple of ints for comparison."""
    parts = v.split(".")
    result = []
    for p in parts:
        # strip any non-numeric suffix like "2025.12.1.post1"
        numeric = ""
        for ch in p:
            if ch.isdigit():
                numeric += ch
            else:
                break
        if numeric:
            result.append(int(numeric))
    return tuple(result)


def _upgrade_ytdlp() -> bool:
    """Run ``pip install --upgrade yt-dlp`` and return True on success."""
    cmd = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--upgrade",
        "--quiet",
        PACKAGE,
    ]
    logger.info("Upgrading %s …", PACKAGE)
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
            logger.warning("pip upgrade failed (rc=%d): %s", result.returncode, result.stderr.strip()[-200:])
            return False
    except subprocess.TimeoutExpired:
        logger.warning("pip upgrade timed out after 300s")
        return False
    except Exception as exc:
        logger.warning("pip upgrade exception: %s", exc)
        return False


# ---------------------------------------------------------------------------
# Background update worker
# ---------------------------------------------------------------------------

def _update_worker(restart_on_success: bool = False) -> None:
    """Background thread: compare versions, upgrade if needed, optionally restart."""
    try:
        current = _current_version()
        latest = _latest_version()

        if latest is None:
            logger.info("Could not reach PyPI — skipping update check.")
            return

        if _parse_version(latest) <= _parse_version(current):
            logger.info(
                "%s is up-to-date (%s). No update needed.",
                PACKAGE,
                current,
            )
            return

        logger.info(
            "New %s version available: %s (installed: %s)",
            PACKAGE,
            latest,
            current,
        )

        success = _upgrade_ytdlp()

        if success and restart_on_success:
            logger.info("Restarting process to load new %s …", PACKAGE)
            os.execv(sys.executable, [sys.executable] + sys.argv)

    except Exception as exc:
        logger.debug("Auto-update worker error: %s", exc)


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
    check_interval = int(os.environ.get("YTDLP_UPDATE_CHECK_INTERVAL", "3600"))

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
