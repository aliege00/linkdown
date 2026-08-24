# VidFetch yt-dlp Server

Self-hosted video download API powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp). Supports **1000+ sites** including YouTube, TikTok, Twitter/X, Instagram, Vimeo, Facebook, and more.

## Quick Start (Local)

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Make sure ffmpeg is installed
# macOS: brew install ffmpeg
# Ubuntu: sudo apt install ffmpeg

# 3. Run the server
python main.py

# 4. Test it
curl "http://localhost:8080/api/info?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

## Docker

```bash
docker build -t vidfetch-ytdlp .
docker run -p 8080:8080 vidfetch-ytdlp
```

## YouTube anti-bot settings (optional)

YouTube sometimes blocks server IPs with "Sign in to confirm you're not a bot".
If that happens, configure one (or both) of these environment variables:

| Variable | Description |
|---|---|
| `YTDLP_COOKIES_FILE` | Path to a Netscape-format `cookies.txt` exported from a logged-in browser session |
| `YTDLP_PO_TOKEN_PROVIDER` | URL of a [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider) server (e.g. `http://127.0.0.1:4416`) — requires the bgutil plugin installed next to yt-dlp |
| `YTDLP_PLAYER_CLIENT` | Optional YouTube player client override, e.g. `tv` or `web_embedded` (fewer bot checks, some formats may be unavailable) |

Example:

```bash
YTDLP_COOKIES_FILE=/data/cookies.txt python main.py
```

## Deploy Options

### Option 1: Railway.app (Recommended — easiest)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new)

1. Click the button above or go to [Railway](https://railway.app)
2. Create a new project → Deploy from GitHub repo
3. Set the root directory to `yt-dlp-server`
4. Railway auto-detects the Dockerfile — no config needed
5. Get your URL (e.g. `https://vidfetch-ytdlp.up.railway.app`)

### Option 2: Fly.io

```bash
# Install flyctl: https://fly.io/docs/hands-on/install-flyctl/
cd yt-dlp-server

# Launch
fly launch --name vidfetch-ytdlp
fly deploy

# Set max memory (yt-dlp can be memory-intensive)
fly scale memory 1024
```

### Option 3: Render

1. Go to [Render Dashboard](https://dashboard.render.com)
2. New → Web Service → Connect your GitHub repo
3. Name: `vidfetch-ytdlp`
4. Root Directory: `yt-dlp-server`
5. Runtime: Docker
6. Plan: Free (or paid for larger files)

### Option 4: Any VPS

```bash
# Install system deps
sudo apt update && sudo apt install -y ffmpeg python3-pip

# Clone & install
git clone <your-repo>
cd yt-dlp-server
pip install -r requirements.txt

# Run with systemd or screen/tmux
python main.py

# Or with uvicorn directly
uvicorn main:app --host 0.0.0.0 --port 8080
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `8080` | Server port |
| `DOWNLOAD_DIR` | `/tmp/vidfetch-downloads` | Temp directory for downloads |
| `CLEANUP_AGE_SECONDS` | `1800` | Auto-delete files after (30 min) |
| `MAX_FILE_SIZE` | `2147483648` | Max file size in bytes (2 GB) |

## API Endpoints

### `GET /api/info?url=<encoded_url>[&is_playlist=true]`

Returns video metadata + available formats. When the URL is a YouTube
playlist (or `is_playlist=true` is passed), returns `is_playlist: true` with
the playlist's `count` and a flat `entries` list so clients can show every
video and offer a "Download all" button.

```json
{
  "success": true,
  "id": "dQw4w9WgXcQ",
  "title": "Rick Astley - Never Gonna Give You Up",
  "duration": 212,
  "thumbnail": "https://i.ytimg.com/vi/...",
  "uploader": "Rick Astley",
  "formats": [
    {
      "format_id": "137+140",
      "ext": "mp4",
      "resolution": "1920x1080",
      "filesize": 52428800,
      "vcodec": "avc1.640028",
      "acodec": "mp4a.40.2",
      "fps": 30,
      "tbr": 2500
    }
  ],
  "best_format_id": "137+140"
}
```

### `GET /api/download?url=<encoded_url>[&format_id=best][&is_playlist=true][&limit=N]`

Downloads the video file as a streaming attachment.

- `format_id`: Optional. Use `best`, `bestaudio`, or a specific format ID from `/api/info`.
- `is_playlist=true`: Downloads **every video** in the playlist and returns a
  single ZIP archive with one numbered file per video.
- `limit`: Optional. With playlists, only grabs the first N videos (e.g.
  `limit=10`). Default `0` = download the whole playlist.

### `GET /api/health`

Health check endpoint.

## Engines

The server uses **two open-source download engines**:

| Engine | Role |
|--------|------|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Primary — 1000+ sites, full format ladder, quality selection |
| [gallery-dl](https://github.com/mikf/gallery-dl) | Automatic **fallback** — sites yt-dlp can't parse (Instagram, Pinterest, some X/Twitter media). Used transparently when yt-dlp fails on `/api/info` and `/api/download`; multi-file results come back as a ZIP |

Both install via `pip install -r requirements.txt`. `GALLERYDL_TIMEOUT`
(seconds, default 300) caps gallery-dl runs.

## Connecting to VidFetch

Once deployed, set the server URL in VidFetch's frontend:

1. Go to your project's **Keys/API keys** tab
2. Add: `VITE_YTDLP_SERVER_URL` = `https://your-server-url.railway.app`
3. Refresh the app — it'll use your self-hosted yt-dlp server

## Cookie Support (for YouTube 429 errors)

If YouTube starts rate-limiting, add cookies:

1. Install a browser extension to export cookies in Netscape format
2. Log into YouTube in your browser
3. Export cookies to `cookies/youtube.txt`
4. Mount it in Docker or place it in the working directory

The server auto-detects `cookies/youtube.txt` if present.
