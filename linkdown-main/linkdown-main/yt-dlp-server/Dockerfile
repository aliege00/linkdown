# ─── VidFetch yt-dlp Server ───────────────────────────────────────────
# Multi-stage build: installs yt-dlp + ffmpeg in a slim Python image.
#
# Build:
#   docker build -t vidfetch-ytdlp ./yt-dlp-server
#
# Run:
#   docker run -p 8080:8080 vidfetch-ytdlp
#
# Deploy to Railway / Fly.io / Render:
#   See yt-dlp-server/README.md for platform-specific instructions.

FROM python:3.12-slim AS builder

WORKDIR /app

# Install system build deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ─── Runtime stage ────────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# Copy ffmpeg from builder
COPY --from=builder /usr/bin/ffmpeg /usr/bin/ffmpeg
COPY --from=builder /usr/bin/ffprobe /usr/bin/ffprobe
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin/yt-dlp /usr/local/bin/yt-dlp
COPY --from=builder /usr/local/bin/uvicorn /usr/local/bin/uvicorn

# Copy application code
COPY main.py .

# Runtime config
ENV HOST=0.0.0.0
ENV PORT=8080
ENV DOWNLOAD_DIR=/tmp/vidfetch-downloads
ENV CLEANUP_AGE_SECONDS=1800
ENV MAX_FILE_SIZE=2147483648

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/api/health')" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
