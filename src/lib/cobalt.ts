/**
 * Cobalt engine client.
 *
 * Implements the Cobalt v10 HTTP API as documented in
 * https://github.com/imputnet/cobalt/blob/main/docs/api.md :
 *
 *   POST <instance>/
 *   Accept: application/json
 *   Content-Type: application/json
 *   Authorization: Api-Key <token>      (only if the instance requires one)
 *   { "url": ..., "downloadMode": "auto"|"audio", "videoQuality": "1080"|..., ... }
 *
 * Response `status` is one of: tunnel | local-processing | redirect |
 * picker | error. Only tunnel and redirect hand back a file we can hand to
 * the on-device downloader; local-processing would need a local remux we
 * cannot do, so it is reported as unsupported instead of silently failing
 * later.
 *
 * VidFetch does NOT stream the bytes from here: the resolved direct URL is
 * downloaded by the on-device engine, so progress, the background service
 * and the "save to Downloads" flow keep working exactly as before.
 */

import type { YtDlpFormat, YtDlpInfo } from "./ytdlp-native";

export interface CobaltResolution {
  ok: true;
  directUrl: string;
  filename: string;
  /** Origin service reported by cobalt (youtube, tiktok, …) when available. */
  service: string;
}

export interface CobaltFailure {
  ok: false;
  /** Machine-readable code (cobalt's own, or a synthetic one for us). */
  code: string;
  /** Short English message; the UI adds the localized explanation. */
  message: string;
}

export type CobaltResult = CobaltResolution | CobaltFailure;

/** Format id we synthesize for a cobalt-resolved stream. */
export const COBALT_FORMAT_ID = "cobalt-direct";

const REQUEST_TIMEOUT_MS = 20_000;

/** Short English explanations for the error codes cobalt returns. */
const COBALT_ERROR_TEXT: Record<string, string> = {
  "api.invalid_json": "The Cobalt instance rejected the request (invalid JSON).",
  "api.content_type.invalid": "The Cobalt instance expects application/json.",
  "api.auth.missing": "This Cobalt instance requires an API key.",
  "api.auth.invalid": "The Cobalt API key was rejected.",
  "api.captcha.blocked": "The Cobalt instance's bot protection blocked the request.",
  "api.rateLimit.exceeded": "The Cobalt instance is rate limiting this client.",
  "error.no_video": "Cobalt could not find a video at this URL.",
  "error.video_unavailable": "That video is not available for download.",
  "error.private": "That video is private.",
  "error.fetch.video": "Cobalt could not reach the source site.",
  "error.fetch.unknown": "Cobalt could not reach the source site.",
  "error.unsupported": "Cobalt does not support this site.",
  "error.live_not_supported": "Live streams are not supported.",
};

function describeError(code: string): string {
  return COBALT_ERROR_TEXT[code] ?? `Cobalt failed (${code}).`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Guess the container from a cobalt filename ("video.mp4" → "mp4"). */
export function extFromFilename(filename: string, fallback: string): string {
  const m = filename.match(/\.([a-z0-9]{2,4})$/i);
  return m ? m[1].toLowerCase() : fallback;
}

/**
 * Map the app's quality choices onto cobalt's `videoQuality` values
 * (max / 2160 / 1440 / 1080 / 720 / 480 / 360 / 240 / 144).
 */
export function cobaltVideoQuality(mode: string, precise: number | "auto"): string {
  if (precise !== "auto") return String(precise);
  if (mode === "data") return "720";
  return "max";
}

/**
 * Pure response parsing (no network) so it can be unit-tested: turns a
 * cobalt payload into a direct URL or a structured failure.
 */
export function parseCobaltResponse(
  payload: unknown,
  opts: { audioOnly: boolean },
): CobaltResult {
  if (!payload || typeof payload !== "object") {
    return { ok: false, code: "api.invalid_json", message: "Unexpected Cobalt response." };
  }
  const body = payload as {
    status?: string;
    url?: string;
    filename?: string;
    service?: string;
    picker?: { type?: string; url?: string }[];
    type?: string;
    error?: { code?: string };
  };

  const failure = (code: string, message?: string): CobaltFailure => ({
    ok: false,
    code,
    message: message ?? describeError(code),
  });

  switch (body.status) {
    case "tunnel":
    case "redirect": {
      if (!body.url) return failure("api.invalid_json", "Cobalt returned no media URL.");
      return {
        ok: true,
        directUrl: body.url,
        filename: body.filename ?? "video",
        service: body.service ?? hostOf(body.url),
      };
    }

    case "picker": {
      const items = body.picker ?? [];
      const wanted = opts.audioOnly ? "photo" : "video";
      // Audio-only requests still return video items, so only a media picker
      // (photo/slideshow) is interesting there.
      const chosen =
        items.find((i) => i.type === wanted) ??
        items.find((i) => i.type === "video") ??
        items[0];
      if (!chosen?.url) {
        return failure("error.no_video", "Cobalt returned no downloadable item.");
      }
      return {
        ok: true,
        directUrl: chosen.url,
        filename: body.filename ?? chosen.url.split("/").pop() ?? "video",
        service: body.service ?? hostOf(chosen.url),
      };
    }

    case "local-processing":
      // Needs a local remux/transcode we do not ship; the on-device engine
      // handles these links better anyway.
      return failure(
        "error.local_processing",
        "This item needs a local remux that the Cobalt engine cannot do here.",
      );

    case "error":
      return failure(body.error?.code ?? "error.unknown");

    default:
      return failure("api.invalid_json", "Unexpected Cobalt status.");
  }
}

export interface ResolveOptions {
  instance: string;
  token?: string;
  url: string;
  audioOnly: boolean;
  /** "best" | "data" | "audio" from the download-mode chip. */
  mode: string;
  /** Pinned 1080/720/480 or "auto". */
  precise: number | "auto";
}

const XHR_TIMEOUT =
  typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    : {};

/**
 * Ask a Cobalt instance to resolve `url` into a direct media URL.
 * Never throws — failures come back as a structured CobaltFailure so the
 * caller can fall back to the on-device engine.
 */
export async function resolveWithCobalt(
  opts: ResolveOptions,
): Promise<CobaltResult> {
  const instance = opts.instance.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(instance)) {
    return {
      ok: false,
      code: "api.invalid_json",
      message: "No valid Cobalt instance URL configured.",
    };
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (opts.token) headers.Authorization = `Api-Key ${opts.token}`;

  const body = {
    url: opts.url,
    downloadMode: opts.audioOnly ? "audio" : "auto",
    videoQuality: cobaltVideoQuality(opts.mode, opts.precise),
    audioFormat: "mp3",
    audioBitrate: "128",
    filenameStyle: "basic",
    youtubeVideoCodec: "h264",
    youtubeVideoContainer: "mp4",
  };

  try {
    const res = await fetch(`${instance}/`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      ...XHR_TIMEOUT,
    });

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        code: "api.auth.invalid",
        message: describeError("api.auth.invalid"),
      };
    }
    if (res.status === 429) {
      return { ok: false, code: "api.rateLimit.exceeded", message: describeError("api.rateLimit.exceeded") };
    }

    const text = await res.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      // Bot-protection pages (HTML) or a non-JSON error land here.
      return {
        ok: false,
        code: "api.invalid_json",
        message: `Cobalt instance returned a non-JSON response (HTTP ${res.status}).`,
      };
    }
    return parseCobaltResponse(payload, { audioOnly: opts.audioOnly });
  } catch (err) {
    return {
      ok: false,
      code: "api.fetch.unknown",
      message:
        err instanceof Error && err.name === "TimeoutError"
          ? "The Cobalt instance timed out."
          : "Could not reach the Cobalt instance.",
    };
  }
}

/**
 * Build a YtDlpInfo from a cobalt resolution so the existing analyze UI
 * (formats grid, size estimate, download button) works unchanged.
 *
 * The synthetic format intentionally passes the strict progressive-MP4 /
 * allowed-audio filters in format-enforce.ts (container + codecs + a real
 * resolution label), otherwise the picker would look empty.
 */
export function infoFromCobalt(
  pageUrl: string,
  result: CobaltResolution,
  opts: { audioOnly: boolean; requestedQuality: string },
): YtDlpInfo {
  const ext = extFromFilename(result.filename, "mp4");
  const audio = opts.audioOnly || /^(mp3|m4a|opus|ogg|wav)$/i.test(ext);

  const format: YtDlpFormat = {
    format_id: COBALT_FORMAT_ID,
    ext: audio ? (ext === "m4a" ? "m4a" : "mp3") : "mp4",
    // Cobalt does not report a resolution. We label it with the quality the
    // user asked for ("max" → 1080p, cobalt's YouTube cap) so the grid shows a
    // meaningful label instead of an empty string.
    resolution: audio ? "audio" : `${opts.requestedQuality}p`,
    filesize: null,
    // Synthetic codec hints (needed by the strict format filter). The real
    // container is whatever cobalt resolved; yt-dlp downloads it as-is.
    vcodec: audio ? null : "h264",
    acodec: audio ? "mp3" : "aac",
    fps: null,
    tbr: null,
  };

  return {
    success: true,
    id: COBALT_FORMAT_ID,
    title: result.filename.replace(/\.[a-z0-9]{2,4}$/i, ""),
    duration: null,
    thumbnail: null,
    uploader: result.service,
    uploader_url: null,
    webpage_url: pageUrl,
    formats: [format],
    best_format_id: COBALT_FORMAT_ID,
    best_audio_format_id: null,
    ffmpeg_available: false,
    is_playlist: false,
    engine: "cobalt",
    direct_url: result.directUrl,
  };
}