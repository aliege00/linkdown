import { describe, it, expect } from "vitest";
import {
  planEngines,
  lastResortEngine,
  cobaltPreferred,
  normalizeInstance,
  isCobaltConfigured,
  DEFAULT_ENGINE_CONFIG,
  type EngineConfig,
} from "@/lib/engines";
import {
  parseCobaltResponse,
  cobaltVideoQuality,
  extFromFilename,
  infoFromCobalt,
  COBALT_FORMAT_ID,
} from "@/lib/cobalt";
import { filterFormats } from "@/lib/format-enforce";

const withInstance = (cfg: Partial<EngineConfig> = {}): EngineConfig => ({
  ...DEFAULT_ENGINE_CONFIG,
  instance: "https://cobalt.example",
  ...cfg,
});

// ─── Instance URL handling ────────────────────────────────────────────

describe("normalizeInstance", () => {
  it("accepts http(s) URLs and strips trailing slashes", () => {
    expect(normalizeInstance("  https://cobalt.example/  ")).toBe(
      "https://cobalt.example",
    );
    expect(normalizeInstance("http://127.0.0.1:9000///")).toBe(
      "http://127.0.0.1:9000",
    );
  });

  it("rejects anything that is not an http(s) URL", () => {
    expect(normalizeInstance("cobalt.example")).toBe("");
    expect(normalizeInstance("javascript:alert(1)")).toBe("");
    expect(normalizeInstance("ftp://cobalt.example")).toBe("");
    expect(normalizeInstance("")).toBe("");
  });

  it("treats a config without an instance as not configured", () => {
    expect(isCobaltConfigured(DEFAULT_ENGINE_CONFIG)).toBe(false);
    expect(isCobaltConfigured(withInstance())).toBe(true);
  });
});

// ─── Routing ──────────────────────────────────────────────────────────

describe("cobaltPreferred", () => {
  it("picks the sites where cobalt usually beats yt-dlp", () => {
    for (const host of [
      "tiktok.com",
      "www.tiktok.com",
      "x.com",
      "instagram.com",
      "reddit.com",
      "facebook.com",
      "soundcloud.com",
    ]) {
      expect(cobaltPreferred(`https://${host}/video/1`)).toBe(true);
    }
  });

  it("leaves quality-oriented sites on the on-device engine", () => {
    for (const host of ["youtube.com", "vimeo.com", "twitch.tv"]) {
      expect(cobaltPreferred(`https://${host}/watch?v=1`)).toBe(false);
    }
  });

  it("is false for garbage input", () => {
    expect(cobaltPreferred("not a url")).toBe(false);
  });
});

describe("planEngines", () => {
  it("stays on-device in a browser (nothing can write to disk)", () => {
    expect(
      planEngines("https://tiktok.com/x", {
        isPlaylist: false,
        mode: "auto",
        native: false,
      }),
    ).toEqual(["ondevice"]);
  });

  it("honors a manual on-device choice even with an instance", () => {
    // (planEngines reads isCobaltConfigured from storage; with no storage in
    // the test env it falls back to the default config → no instance.)
    expect(
      planEngines("https://tiktok.com/x", {
        isPlaylist: false,
        mode: "ondevice",
        native: true,
      }),
    ).toEqual(["ondevice"]);
  });

  it("keeps playlists on the on-device engine", () => {
    expect(
      planEngines("https://youtube.com/playlist?list=x", {
        isPlaylist: true,
        mode: "cobalt",
        native: true,
      }),
    ).toEqual(["ondevice"]);
  });

  it("never returns an empty plan, so analyze always has a fallback", () => {
    const plans = [
      planEngines("https://youtube.com/watch?v=1", {
        isPlaylist: false,
        mode: "auto",
        native: true,
      }),
      planEngines("https://youtube.com/watch?v=1", {
        isPlaylist: false,
        mode: "cobalt",
        native: true,
      }),
    ];
    for (const plan of plans) {
      expect(plan.length).toBeGreaterThan(0);
      expect(plan[plan.length - 1]).toBe("ondevice");
    }
  });
});

describe("lastResortEngine", () => {
  it("does not retry an engine that was already tried", () => {
    expect(lastResortEngine("https://tiktok.com/x", ["cobalt"], "auto")).toBeNull();
  });

  it("never overrides a manual on-device choice", () => {
    expect(lastResortEngine("https://tiktok.com/x", ["ondevice"], "ondevice")).toBeNull();
  });

  it("does nothing without a configured instance", () => {
    expect(lastResortEngine("https://tiktok.com/x", ["ondevice"], "auto")).toBeNull();
  });
});

// ─── Cobalt response parsing ──────────────────────────────────────────

describe("parseCobaltResponse", () => {
  it("accepts tunnel and redirect responses", () => {
    for (const status of ["tunnel", "redirect"]) {
      const r = parseCobaltResponse(
        { status, url: "https://cdn.example/v.mp4", filename: "v.mp4" },
        { audioOnly: false },
      );
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.directUrl).toBe("https://cdn.example/v.mp4");
    }
  });

  it("takes the first video from a picker", () => {
    const r = parseCobaltResponse(
      {
        status: "picker",
        picker: [
          { type: "photo", url: "https://cdn.example/1.jpg" },
          { type: "video", url: "https://cdn.example/2.mp4" },
        ],
      },
      { audioOnly: false },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.directUrl).toBe("https://cdn.example/2.mp4");
  });

  it("reports local-processing as unsupported instead of guessing", () => {
    const r = parseCobaltResponse(
      { status: "local-processing", type: "merge" },
      { audioOnly: false },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("error.local_processing");
  });

  it("surfaces cobalt's own error codes with a readable message", () => {
    const r = parseCobaltResponse(
      { status: "error", error: { code: "error.private" } },
      { audioOnly: false },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("error.private");
      expect(r.message.length).toBeGreaterThan(0);
    }
  });

  it("rejects non-objects and unknown statuses safely", () => {
    expect(parseCobaltResponse(null, { audioOnly: false }).ok).toBe(false);
    expect(parseCobaltResponse({ status: "weird" }, { audioOnly: false }).ok).toBe(false);
  });
});

// ─── Helpers + synthesized info ───────────────────────────────────────

describe("cobaltVideoQuality", () => {
  it("maps the app's choices onto cobalt's values", () => {
    expect(cobaltVideoQuality("best", "auto")).toBe("max");
    expect(cobaltVideoQuality("data", "auto")).toBe("720");
    expect(cobaltVideoQuality("best", 1080)).toBe("1080");
  });
});

describe("extFromFilename", () => {
  it("reads the container from the filename", () => {
    expect(extFromFilename("clip.mp4", "mp4")).toBe("mp4");
    expect(extFromFilename("clip.M4A", "mp4")).toBe("m4a");
    expect(extFromFilename("noext", "mp4")).toBe("mp4");
  });
});

describe("infoFromCobalt", () => {
  const resolution = {
    ok: true as const,
    directUrl: "https://cdn.example/v.mp4",
    filename: "coastline.mp4",
    service: "tiktok",
  };

  it("produces a format the strict picker keeps", () => {
    const info = infoFromCobalt("https://tiktok.com/x", resolution, {
      audioOnly: false,
      requestedQuality: "1080",
    });
    expect(info.engine).toBe("cobalt");
    expect(info.direct_url).toBe(resolution.directUrl);
    const filtered = filterFormats(info.formats);
    expect(filtered.progressiveMp4).toHaveLength(1);
    expect(filtered.progressiveMp4[0].format_id).toBe(COBALT_FORMAT_ID);
  });

  it("marks audio-only results as audio formats", () => {
    const info = infoFromCobalt(
      "https://tiktok.com/x",
      { ...resolution, filename: "song.mp3" },
      { audioOnly: true, requestedQuality: "max" },
    );
    const filtered = filterFormats(info.formats);
    expect(filtered.audioFormats).toHaveLength(1);
    expect(filtered.progressiveMp4).toHaveLength(0);
  });
});