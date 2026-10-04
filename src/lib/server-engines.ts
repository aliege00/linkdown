/**
 * Server engines: a self-hosted yt-dlp HTTP API and a Seal-compatible server.
 *
 * Both work like Cobalt (see lib/cobalt.ts): they RESOLVE a page URL to one
 * direct media file on the server, and the bytes are then downloaded by the
 * on-device engine, so progress, the Downloads folder and background saving
 * behave exactly as they do for a local video.
 *
 * Nothing here is hard-coded to a vendor: the user pastes their own address
 * in Ayarlar → İndirme motoru, and the app always falls back to the on-device
 * engine when a server call fails — so a wrong or dead address can never make
 * a download fail that used to work.
 */

import type { YtDlpFormat, YtDlpInfo } from "@/lib/ytdlp-native";
import { normalizeInstance } from "@/lib/engines";

export type ServerEngine = "server" | "seal";

export interface ServerResolution {
  directUrl: string;
  title: string;
  thumbnail: string | null;
  /** "server" or "seal" — recorded on the result so the UI can label it. */
  engine: ServerEngine;
  /** The server this URL came from (shown in error messages). */
  service: string;
}

export type ServerResult =
  | { ok: true; resolution: ServerResolution }
  | { ok: false; message: string };

export interface ServerResolveOptions {
  /** User picked "ses" mode → ask for an audio-only stream. */
  audioOnly: boolean;
  /** Requested height as a string ("max", "1080", "720", "480"). */
  requestedQuality: string;
}

/** Synthetic format id: one direct URL == one selectable format. */
export const SERVER_FORMAT_ID = "server-direct";
export const SEAL_FORMAT_ID = "seal-direct";

function targetHeight(requested: string): number {
  if (requested === "max") return 1080;
  const n = Number.parseInt(requested, 10);
  return Number.isFinite(n) && n > 0 ? n : 1080;
}

/**
 * Choose the stream closest to the requested height, never above it unless
 * nothing smaller exists. Ties prefer the larger file.
 */
function pickByQuality(
  formats: { height: number | null; url: string }[],
  requested: string,
): string | null {
  const usable = formats.filter((f) => typeof f.url === "string" && f.url.length > 0);
  if (usable.length === 0) return null;

  const withHeight = usable.filter((f) => typeof f.height === "number" && f.height > 0);
  if (withHeight.length === 0) return usable[0].url;

  if (requested === "max") {
    return withHeight.reduce((best, f) =>
      (f.height ?? 0) > (best.height ?? 0) ? f : best,
    ).url;
  }

  const want = targetHeight(requested);
  const atOrBelow = withHeight.filter((f) => (f.height ?? 0) <= want);
  const pool = atOrBelow.length > 0 ? atOrBelow : withHeight;
  return pool.reduce((best, f) =>
    Math.abs((f.height ?? 0) - want) < Math.abs((best.height ?? 0) - want) ? f : best,
  ).url;
}

/** Height of a yt-dlp / Seal quality label ("1080p60", "720", "360p"). */
function parseHeight(label: unknown): number | null {
  if (typeof label === "number") return label;
  if (typeof label !== "string") return null;
  const m = label.match(/(\d{3,4})/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  // Audio-only entries have no height match at all ("140 kbps" → null).
  return Number.isFinite(n) ? n : null;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const detail =
      (body as { message?: string; error?: string })?.message ??
      (body as { error?: string })?.error;
    if (typeof detail === "string" && detail) return detail;
  } catch {
    // Body was not JSON — fall through to the status-based message.
  }
  return `Sunucu ${response.status} döndürdü`;
}

/**
 * Resolve via a self-hosted yt-dlp HTTP API.
 * Endpoint shape: GET {server}/?url=<encoded> returning raw yt-dlp JSON —
 * the convention used by yt-dlp-web and the usual "docker run" one-liners.
 */
export async function resolveWithYtdlpServer(
  pageUrl: string,
  serverUrl: string,
  opts: ServerResolveOptions & { token?: string },
): Promise<ServerResult> {
  const base = normalizeInstance(serverUrl);
  if (!base) return { ok: false, message: "yt-dlp sunucu adresi boş" };

  try {
    const response = await fetch(`${base}/?url=${encodeURIComponent(pageUrl)}`, {
      headers: authHeaders(opts),
    });
    if (!response.ok) return { ok: false, message: await readError(response) };

    const data = (await response.json()) as {
      title?: string;
      thumbnail?: string;
      formats?: { url?: string; height?: number | null; format_note?: string }[];
    };

    const candidates = (data.formats ?? [])
      .filter((f) => !/audio|storyboard/i.test(f.format_note ?? ""))
      .map((f) => ({ height: f.height ?? null, url: f.url ?? "" }));

    const directUrl = pickByQuality(candidates, opts.requestedQuality);
    if (!directUrl) return { ok: false, message: "Sunucu uygun video akışı döndürmedi" };

    return {
      ok: true,
      resolution: {
        directUrl,
        title: data.title ?? pageUrl,
        thumbnail: data.thumbnail ?? null,
        engine: "server",
        service: base,
      },
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "yt-dlp sunucusuna ulaşılamadı",
    };
  }
}

/** Optional bearer header for a protected yt-dlp API. */
function authHeaders(opts: { token?: string }): HeadersInit {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  return headers;
}

/**
 * Resolve via a Seal-compatible server: GET {seal}/api/v1/info?url=…
 * Seal returns { status, title, thumbnailURL, formats: [{ quality, url }] }.
 */
export async function resolveWithSeal(
  pageUrl: string,
  sealUrl: string,
  opts: ServerResolveOptions,
): Promise<ServerResult> {
  const base = normalizeInstance(sealUrl);
  if (!base) return { ok: false, message: "Seal sunucu adresi boş" };

  try {
    const response = await fetch(
      `${base}/api/v1/info?url=${encodeURIComponent(pageUrl)}`,
    );
    if (!response.ok) return { ok: false, message: await readError(response) };

    const data = (await response.json()) as {
      status?: string;
      errorMsg?: string;
      title?: string;
      thumbnailURL?: string;
      formats?: { quality?: string; url?: string; videoOnly?: boolean }[];
    };

    if (data.status && data.status !== "info") {
      return {
        ok: false,
        message: data.errorMsg ?? `Seal sunucusu "${data.status}" döndürdü`,
      };
    }

    const candidates = (data.formats ?? [])
      .filter((f) => !f.videoOnly)
      .map((f) => ({ height: parseHeight(f.quality), url: f.url ?? "" }));

    const directUrl = pickByQuality(candidates, opts.requestedQuality);
    if (!directUrl) return { ok: false, message: "Seal uygun video akışı döndürmedi" };

    return {
      ok: true,
      resolution: {
        directUrl,
        title: data.title ?? pageUrl,
        thumbnail: data.thumbnailURL ?? null,
        engine: "seal",
        service: base,
      },
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Seal sunucusuna ulaşılamadı",
    };
  }
}

/**
 * Wrap a resolution in the standard YtDlpInfo shape with ONE synthetic
 * format. The synthetic format carries a real container, codec hints and a
 * resolution label so the strict filters in format-enforce.ts keep the picker
 * (and the "Data Saver" chain) working exactly as they do for Cobalt.
 */
export function infoFromServer(pageUrl: string, res: ServerResolution, opts: ServerResolveOptions): YtDlpInfo {
  const formatId = res.engine === "seal" ? SEAL_FORMAT_ID : SERVER_FORMAT_ID;
  const audio = opts.audioOnly;
  const label =
    opts.requestedQuality === "max" ? "1080" : (opts.requestedQuality || "1080");

  const format: YtDlpFormat = {
    format_id: formatId,
    ext: audio ? "m4a" : "mp4",
    resolution: audio ? "audio" : `${label}p`,
    filesize: null,
    vcodec: audio ? null : "h264",
    acodec: audio ? "mp4a" : "aac",
    fps: null,
    tbr: null,
  };

  return {
    success: true,
    id: formatId,
    title: res.title,
    duration: null,
    thumbnail: res.thumbnail,
    uploader: res.engine === "seal" ? "Seal" : "yt-dlp sunucusu",
    uploader_url: null,
    webpage_url: pageUrl,
    formats: [format],
    best_format_id: formatId,
    best_audio_format_id: null,
    ffmpeg_available: false,
    is_playlist: false,
    engine: res.engine,
    direct_url: res.directUrl,
  };
}