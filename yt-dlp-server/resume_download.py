"""
Pause / Resume Download Manager
================================

Manages download state persistence so interrupted downloads can be resumed
from the last saved byte offset instead of starting from scratch.

Architecture:
  1. Each download has a .state JSON file alongside its .part files
  2. On pause, the current state is serialised to disk
  3. On resume, the state is loaded and download continues from offsets
  4. On crash/kill, the .part files + .state survive for next startup

State file format (.state):
  {
    "url": "https://...",
    "output_path": "/tmp/video.mp4",
    "total_size": 12345678,
    "chunks": [
      {"index": 0, "start": 0, "end": 4194303, "downloaded": 4194303, "completed": true},
      {"index": 1, "start": 4194304, "end": 8388607, "downloaded": 2097152, "completed": false},
      ...
    ],
    "etag": "...",
    "last_modified": "...",
    "created_at": 1724500000.0,
    "updated_at": 1724500050.0
  }

Environment variables:
  DOWNLOAD_DIR
      Base directory for .part and .state files (default: /tmp/vidfetch-downloads)
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger("vidfetch.resume")


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@dataclass
class ResumeState:
    """Serializable download state for pause/resume."""
    url: str
    output_path: str
    total_size: int = 0
    chunks: list[dict] = field(default_factory=list)
    threads: int = 8
    etag: Optional[str] = None
    last_modified: Optional[str] = None
    content_type: Optional[str] = None
    filename: Optional[str] = None
    created_at: float = 0.0
    updated_at: float = 0.0
    finished: bool = False
    failed: bool = False
    error: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict) -> "ResumeState":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


# ---------------------------------------------------------------------------
# Manager
# ---------------------------------------------------------------------------

class ResumeManager:
    """
    Manages download state persistence for pause/resume.

    Usage::

        manager = ResumeManager("/tmp/vidfetch-downloads")

        # Save state
        state = ResumeState(url="...", output_path="/tmp/video.mp4", ...)
        manager.save_state(state)

        # Load state
        loaded = manager.load_state("/tmp/video.mp4.state")

        # List resumable downloads
        downloads = manager.list_resumable()

        # Cleanup finished downloads
        manager.cleanup(state)
    """

    def __init__(self, download_dir: str = "/tmp/vidfetch-downloads"):
        self.download_dir = Path(download_dir)
        self.download_dir.mkdir(parents=True, exist_ok=True)

    def state_path(self, output_path: str) -> str:
        """Get the .state file path for a given output file."""
        return f"{output_path}.state"

    def save_state(self, state: ResumeState) -> str:
        """
        Save download state to disk.

        Returns the path to the .state file.
        """
        state.updated_at = time.time()
        path = self.state_path(state.output_path)

        try:
            data = asdict(state)
            with open(path, "w") as f:
                json.dump(data, f, indent=2)
            logger.debug("State saved: %s", path)
            return path
        except Exception as exc:
            logger.error("Failed to save state to %s: %s", path, exc)
            return ""

    def load_state(self, output_path: str) -> Optional[ResumeState]:
        """
        Load download state from disk.

        Returns None if no valid state file exists.
        """
        path = self.state_path(output_path)

        if not os.path.exists(path):
            return None

        try:
            with open(path) as f:
                data = json.load(f)

            state = ResumeState.from_dict(data)

            # Validate: check that at least some .part files exist
            if state.chunks:
                existing_parts = sum(
                    1 for c in state.chunks
                    if os.path.exists(c.get("part_file", ""))
                )
                if existing_parts == 0:
                    logger.info("No .part files found for %s — fresh download needed", output_path)
                    return None

            logger.info(
                "Loaded state: %s (%d chunks, %d/%d bytes)",
                output_path,
                len(state.chunks),
                sum(c.get("downloaded", 0) for c in state.chunks),
                state.total_size,
            )
            return state

        except (json.JSONDecodeError, KeyError, TypeError) as exc:
            logger.warning("Corrupt state file %s: %s — removing", path, exc)
            try:
                os.remove(path)
            except OSError:
                pass
            return None

    def list_resumable(self) -> list[ResumeState]:
        """
        List all downloads that can be resumed.

        Returns a list of ResumeState objects sorted by most recently updated.
        """
        states = []
        for state_file in self.download_dir.glob("*.state"):
            try:
                with open(state_file) as f:
                    data = json.load(f)
                state = ResumeState.from_dict(data)
                if not state.finished and not state.failed:
                    # Check if .part files exist
                    has_parts = any(
                        os.path.exists(c.get("part_file", ""))
                        for c in state.chunks
                    )
                    if has_parts:
                        states.append(state)
            except Exception as exc:
                logger.debug("Skipping corrupt state file %s: %s", state_file, exc)

        # Sort by most recently updated
        states.sort(key=lambda s: s.updated_at, reverse=True)
        return states

    def cleanup(self, state: ResumeState):
        """
        Remove .part files and .state file after successful download.
        """
        # Remove .part files
        for chunk in state.chunks:
            part_file = chunk.get("part_file", "")
            if part_file and os.path.exists(part_file):
                try:
                    os.remove(part_file)
                except OSError as exc:
                    logger.debug("Could not remove %s: %s", part_file, exc)

        # Remove .state file
        state_path = self.state_path(state.output_path)
        if os.path.exists(state_path):
            try:
                os.remove(state_path)
            except OSError as exc:
                logger.debug("Could not remove %s: %s", state_path, exc)

        logger.info("Cleaned up state for %s", state.output_path)

    def cleanup_stale(self, max_age_hours: int = 24):
        """
        Remove state files older than max_age_hours.
        Called periodically to prevent disk bloat.
        """
        cutoff = time.time() - (max_age_hours * 3600)
        removed = 0

        for state_file in self.download_dir.glob("*.state"):
            try:
                if os.path.getmtime(state_file) < cutoff:
                    # Load to find .part files
                    with open(state_file) as f:
                        data = json.load(f)
                    state = ResumeState.from_dict(data)

                    # Remove .part files
                    for chunk in state.chunks:
                        part = chunk.get("part_file", "")
                        if part and os.path.exists(part):
                            os.remove(part)

                    os.remove(state_file)
                    removed += 1
            except Exception:
                try:
                    os.remove(state_file)
                    removed += 1
                except OSError:
                    pass

        if removed:
            logger.info("Cleaned up %d stale state files", removed)

    def get_resume_info(self, output_path: str) -> Optional[dict]:
        """
        Get resume information for a download — useful for the frontend.

        Returns::

            {
                "can_resume": true,
                "downloaded_bytes": 5242880,
                "total_size": 12345678,
                "percent": 42.5,
                "chunks_completed": 1,
                "chunks_total": 3,
                "part_files": ["/tmp/video.mp4.part0", ...]
            }
        """
        state = self.load_state(output_path)
        if not state or not state.chunks:
            return None

        downloaded = sum(c.get("downloaded", 0) for c in state.chunks)
        completed = sum(1 for c in state.chunks if c.get("completed", False))
        part_files = [c.get("part_file", "") for c in state.chunks if c.get("part_file")]

        return {
            "can_resume": True,
            "downloaded_bytes": downloaded,
            "total_size": state.total_size,
            "percent": (downloaded / state.total_size * 100) if state.total_size > 0 else 0,
            "chunks_completed": completed,
            "chunks_total": len(state.chunks),
            "part_files": part_files,
        }
