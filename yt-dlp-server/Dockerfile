FROM python:3.12-slim

# ffmpeg is required to merge separate video+audio streams (YouTube ≥720p)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Downloads are staged here; files are auto-deleted after 30 minutes.
ENV DOWNLOAD_DIR=/data
ENV PORT=8080

RUN mkdir -p /data

EXPOSE 8080

# yt-dlp can be memory-intensive on large files; recommend at least 1 GB RAM.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
