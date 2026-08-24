"""
VidFetch yt-dlp Server — functional + benchmark harness.

Tests the pure helpers in main.py without network access or yt-dlp installed:
  1. Functional assertions (edge-case matrix)
  2. Micro-benchmarks (timeit) for hot paths
  3. Memory profile (tracemalloc) for playlist payload building

Usage: python3 scripts/test_server_bench.py
"""

import sys
import tempfile
import time
import timeit
import tracemalloc
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "yt-dlp-server"))

# ── Stub heavy deps so main.py imports without fastapi/yt_dlp installed ──
try:
    import fastapi  # noqa: F401
    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False
    import types as _t

    fastapi = _t.ModuleType("fastapi")

    class _Stub:
        def __init__(self, *a, **k):
            pass
        def __call__(self, *a, **k):
            return self
        def get(self, *a, **k):
            def deco(fn):
                return fn
            return deco
        def add_middleware(self, *a, **k):
            pass

    class HTTPException(Exception):
        def __init__(self, status_code=None, detail=None):
            self.status_code = status_code
            self.detail = detail
            super().__init__(detail)

    class BackgroundTasks:
        def add_task(self, *a, **k):
            pass

    def Query(default=None, **k):
        return default

    fastapi.BackgroundTasks = BackgroundTasks
    fastapi.FastAPI = _Stub
    fastapi.HTTPException = HTTPException
    fastapi.Query = Query

    mw = _t.ModuleType("fastapi.middleware")
    cors = _t.ModuleType("fastapi.middleware.cors")
    cors.CORSMiddleware = _Stub
    mw.cors = cors
    fastapi.middleware = mw

    resp = _t.ModuleType("fastapi.responses")
    resp.FileResponse = _Stub
    fastapi.responses = resp

    sys.modules["fastapi"] = fastapi
    sys.modules["fastapi.middleware"] = mw
    sys.modules["fastapi.middleware.cors"] = cors
    sys.modules["fastapi.responses"] = resp

import main  # noqa: E402

PASS = []
FAIL = []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    mark = "✅" if cond else "❌"
    print(f"  {mark} {name}" + (f" — {detail}" if detail and not cond else ""))


print("=" * 62)
print("1) FUNCTIONAL EDGE-CASE MATRIX")
print("=" * 62)

# Playlist URL detection
check("playlist: watch?v=X&list=Y detected",
      bool(main.PLAYLIST_URL_RE.search("https://youtube.com/watch?v=a&list=PL1")))
check("playlist: /playlist path detected",
      bool(main.PLAYLIST_URL_RE.search("https://youtube.com/playlist?list=PL1")))
check("single video NOT flagged as playlist",
      not main.PLAYLIST_URL_RE.search("https://youtu.be/abc"))

# Friendly error sanitization
fe = main._friendly_error(Exception("ERROR: [youtube] xyz: Sign in to confirm you're not a bot"))
check("friendly error strips ERROR prefix", fe.startswith("Sign in"), fe)

# Absolutize flat entries
check("absolutize: relative path joined to base",
      main._absolutize("/watch?v=abc", "https://youtube.com/watch?x=1") == "https://youtube.com/watch?v=abc")
check("absolutize: absolute URL untouched",
      main._absolutize("https://tiktok.com/@u/v/1", "https://x") == "https://tiktok.com/@u/v/1")
check("absolutize: empty stays empty", main._absolutize("", "https://x") == "")

# Format curation
fake_formats = (
    [{"format_id": f"sb{i}", "vcodec": "vp9", "acodec": "none"} for i in range(5)]   # storyboards
    + [{"format_id": "137", "vcodec": "avc1", "acodec": "none", "height": 1080, "width": 1920, "tbr": 2500},
       {"format_id": "140", "vcodec": "none", "acodec": "mp4a", "abr": 128}]
    + [{"format_id": "dup", "ext": "mp4", "vcodec": "avc1", "acodec": "none"},
       {"format_id": "dup", "ext": "mp4", "vcodec": "avc1", "acodec": "none"}]
    + [{"format_id": "both-none", "vcodec": None, "acodec": None}]
)
curated = main._curate_formats(fake_formats)
ids = [f["format_id"] for f in curated]
check("curate: storyboards dropped", all(not i.startswith("sb") for i in ids))
check("curate: duplicates dropped", ids.count("dup") == 1)
check("curate: none/none codec combos dropped", "both-none" not in ids)
check("curate: keeps real formats", {"137", "140"} <= set(ids))

# Best format selection
info = {"formats": fake_formats}
best, best_audio = main._best_format_id(info)
check("best format is video+audio combo", best == "137+140" and best_audio == "140", f"{best}/{best_audio}")

audio_only_info = {"formats": [{"format_id": "140", "vcodec": "none", "acodec": "mp4a"}]}
b2, ba2 = main._best_format_id(audio_only_info)
check("audio-only source returns audio best", b2 == "140" and ba2 == "140", f"{b2}/{ba2}")

# Thumbnail guards (the TypeError fix from this round)
bad_entry = {"id": "1", "title": "T", "thumbnails": ["not-a-dict"]}
p = main._entry_payload(bad_entry, "https://x")
check("entry payload survives non-dict thumbnail list", p["thumbnail"] is None)
bad_info = {"id": "1", "title": "T", "thumbnails": ["not-a-dict"], "formats": []}
ip = main._info_payload(bad_info, "https://x")
check("info payload survives non-dict thumbnail list", ip["thumbnail"] is None)

# Zero-byte / partial file filtering (filesystem-backed check)
with tempfile.TemporaryDirectory() as td:
    d = Path(td)
    for name, size in [("real.mp4", 1024), ("zero.mp4", 0), ("part.mp4.part", 999),
                       ("state.ytdl", 10), ("tmp.temp", 10)]:
        (d / name).write_bytes(b"x" * size)
    names = sorted(f.name for f in main._finished_files(d))
    check("finished-files: zero-byte excluded", "zero.mp4" not in names, str(names))
    check("finished-files: .part/.ytdl/.temp excluded",
          all(n.endswith((".part", ".ytdl", ".temp")) is False for n in names))
    check("finished-files: valid file kept", names == ["real.mp4"], str(names))

# Largest-file selection logic mirrors _download_single's max()
with tempfile.TemporaryDirectory() as td:
    d = Path(td)
    (d / "video.f137.mp4").write_bytes(b"v" * 100_000)
    (d / "audio.f140.m4a").write_bytes(b"a" * 20_000)
    files = main._finished_files(d)
    target = max(files, key=lambda p: p.stat().st_size)
    check("largest-file pick selects video over audio", target.name == "video.f137.mp4")

print()
print("=" * 62)
print("2) MICRO-BENCHMARKS (hot paths)")
print("=" * 62)

urls = [f"https://youtube.com/watch?v=v{i}&list=PL{i}" for i in range(500)]
urls += ["https://youtu.be/abc"] * 500
n = 2000
t = timeit.timeit(lambda: [main.PLAYLIST_URL_RE.search(u) for u in urls], number=n // 10)
per_call_us = t / (n // 10) / len(urls) * 1e6
print(f"  PLAYLIST_URL_RE      : {per_call_us:8.2f} µs/url  ({len(urls)*n//10:,} scans)")

fmts = ([{"format_id": str(i), "height": i % 1080, "width": 1920, "tbr": float(i),
          "fps": 30, "vcodec": "avc1", "acodec": "none", "filesize": 1 << 20,
          "ext": "mp4", "format_note": ""} for i in range(200)])
rep = 300
t = timeit.timeit(lambda: main._curate_formats(fmts), number=rep)
print(f"  _curate_formats(200) : {t/rep*1e3:8.3f} ms/call")

t = timeit.timeit(lambda: main._best_format_id({"formats": fmts}), number=rep)
print(f"  _best_format_id(200) : {t/rep*1e3:8.3f} ms/call")

err = Exception("ERROR: [youtube] abc: " + "long message " * 40)
t = timeit.timeit(lambda: main._friendly_error(err), number=2000)
print(f"  _friendly_error      : {t/2000*1e6:8.2f} µs/call")

entries = [{"id": str(i), "title": f"Video {i} 🎬", "webpage_url": f"/watch?v={i}",
            "duration": i, "thumbnails": [{"url": f"https://i.ytimg.com/{i}.jpg"}]}
           for i in range(500)]
t = timeit.timeit(lambda: [main._entry_payload(e, "https://youtube.com/w") for e in entries], number=50)
print(f"  _entry_payload x500  : {t/50*1e3:8.3f} ms/batch")

print()
print("=" * 62)
print("3) MEMORY PROFILE (playlist payload build)")
print("=" * 62)

tracemalloc.start()
payloads = [main._entry_payload(e, "https://youtube.com/w") for e in entries]
current, peak = tracemalloc.get_traced_memory()
tracemalloc.stop()
print(f"  500-entry payloads   : current={current/1024:.0f} KB  peak={peak/1024:.0f} KB")
del payloads

rss_kb = None
try:
    import resource
    rss_kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
except ImportError:
    pass

cpu = time.process_time()
print()
print("=" * 62)
print(f"RESULT: {len(PASS)} passed, {len(FAIL)} failed | CPU time: {cpu:.2f}s"
      + (f" | peak RSS: {rss_kb/1024:.0f} MB" if rss_kb else ""))
print("=" * 62)
sys.exit(1 if FAIL else 0)
