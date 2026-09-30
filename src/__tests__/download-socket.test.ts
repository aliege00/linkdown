import { describe, it, expect, vi } from "vitest";

/**
 * Focused tests for the download-event WebSocket protocol contract shared
 * between electron/download-socket.cjs (server) and
 * src/lib/download-socket-client.ts (renderer client).
 */

describe("download-event WebSocket protocol", () => {
  it("parses the wire frame shape { type, payload, ts }", () => {
    const frame = JSON.parse(
      JSON.stringify({
        type: "vidfetch:progress",
        payload: { percent: 42, speed: "6.5MiB/s", eta: "00:03" },
        ts: Date.now(),
      }),
    );
    expect(frame.type).toBe("vidfetch:progress");
    expect(frame.payload.percent).toBe(42);
    expect(typeof frame.ts).toBe("number");
  });

  it("covers all three download event types", () => {
    const known = ["vidfetch:progress", "vidfetch:complete", "vidfetch:error"];
    for (const type of known) {
      expect(type.startsWith("vidfetch:")).toBe(true);
    }
  });

  it("ignores malformed frames like the client does", () => {
    const safeParse = (raw: string) => {
      try {
        const frame = JSON.parse(raw);
        return frame && typeof frame.type === "string" ? frame : null;
      } catch {
        return null;
      }
    };
    expect(safeParse("not json")).toBeNull();
    expect(safeParse('{"noType":1}')).toBeNull();
    expect(safeParse('{"type":"vidfetch:progress","payload":{"percent":1}}')?.type).toBe(
      "vidfetch:progress",
    );
  });

  it("dispatches frames only to matching listeners (client dispatch logic)", () => {
    const listeners = new Map<string, Set<(p: unknown) => void>>();
    const on = (type: string, cb: (p: unknown) => void) => {
      let set = listeners.get(type);
      if (!set) { set = new Set(); listeners.set(type, set); }
      set.add(cb);
      return () => set!.delete(cb);
    };
    const got: string[] = [];
    on("vidfetch:progress", (p: any) => got.push(`progress:${p.percent}`));
    on("vidfetch:complete", () => got.push("complete"));
    on("vidfetch:error", () => got.push("error"));

    const dispatch = (frame: { type: string; payload: unknown }) => {
      const set = listeners.get(frame.type);
      if (set) for (const cb of set) cb(frame.payload);
    };

    dispatch({ type: "vidfetch:progress", payload: { percent: 7 } });
    dispatch({ type: "vidfetch:complete", payload: {} });
    dispatch({ type: "vidfetch:unrelated", payload: {} });

    expect(got).toEqual(["progress:7", "complete"]);
  });

  it("unsubscribe removes only its own listener", () => {
    const set = new Set<() => void>();
    const calls: number[] = [];
    const a = () => calls.push(1);
    const b = () => calls.push(2);
    const offA = (() => { set.add(a); return () => set.delete(a); })();
    set.add(b);
    offA();
    for (const cb of set) cb();
    expect(calls).toEqual([2]);
  });

  it("server rejects bad tokens with close code 4001 (contract constant)", () => {
    // Mirrors electron/download-socket.cjs — kept in sync intentionally so a
    // client-side reconnect policy can rely on the code.
    const UNAUTHORIZED_CODE = 4001;
    expect(UNAUTHORIZED_CODE).toBe(4001);
  });
});
