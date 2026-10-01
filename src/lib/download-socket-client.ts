/**
 * Download-event WebSocket client (renderer side).
 *
 * Receives download status updates (progress / complete / error) from the
 * Electron main process over ws://127.0.0.1:<port>/?token=<session token>.
 * The token + URL come exclusively through the contextIsolated preload
 * bridge (window.vidfetch.getSocketInfo) — never from any file or URL.
 *
 * Reliability model:
 *   • While the socket is OPEN, this client is the primary channel —
 *     main.cjs broadcasts events here instead of over webContents.send.
 *   • While CONNECTING/RECONNECTING, main.cjs falls back to IPC
 *     automatically (its broadcast returns false when no WS client is
 *     attached), so no event is lost in either state.
 *   • App-level ping/pong every 20s detects dead sockets within ~40s and
 *     triggers an immediate reconnect; close/error trigger one instantly.
 *   • Reconnects back off 1s → 2s → 4s → 8s (capped at 8s) and re-fetch
 *     fresh socket info, so the app survives a main-process restart of the
 *     server (new port/token) as well.
 */

export type DownloadSocketEvent =
  | "vidfetch:progress"
  | "vidfetch:complete"
  | "vidfetch:error";

type Listener = (payload: Record<string, unknown>) => void;

interface SocketInfo {
  url: string;
  token: string;
}

const PING_INTERVAL_MS = 20_000;
/** Miss more than this many pings in a row → treat the socket as dead. */
const MAX_MISSED_PINGS = 2;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 8_000;

class DownloadSocketClient {
  private ws: WebSocket | null = null;
  private state: "idle" | "connecting" | "open" | "reconnecting" = "idle";
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private missedPings = 0;
  private listeners = new Map<DownloadSocketEvent, Set<Listener>>();
  private disposed = false;
  private info: SocketInfo | null = null;

  constructor() {
    // Auto-start when running inside the EXE (window.vidfetch exists).
    if (typeof window !== "undefined" && window.vidfetch?.getSocketInfo) {
      this.start();
    }
  }

  /** Current state — exposed for tests and diagnostics. */
  get currentState() {
    return this.state;
  }

  async start() {
    if (this.disposed || this.state === "open" || this.state === "connecting") return;
    const bridge = window.vidfetch;
    if (!bridge?.getSocketInfo) return;
    this.state = "connecting";
    try {
      this.info = await bridge.getSocketInfo();
    } catch {
      this.info = null;
    }
    if (!this.info) {
      // Main process is IPC-only right now (WS server failed to start or is
      // restarting) — retry occasionally in case it comes up later. The
      // state MUST leave "connecting" here: start() refuses to run while
      // connecting, so leaving it set would deadlock the retry timer and
      // permanently kill the socket after a single failed info fetch.
      this.state = "reconnecting";
      this.scheduleReconnect();
      return;
    }
    this.connect(this.info);
  }

  private connect(info: SocketInfo) {
    if (this.disposed) return;
    try {
      const ws = new WebSocket(`${info.url}/?token=${info.token}`);
      this.ws = ws;

      ws.onopen = () => {
        this.state = "open";
        this.attempts = 0;
        this.missedPings = 0;
        this.startPingLoop();
      };

      ws.onmessage = (ev) => {
        try {
          const frame = JSON.parse(String(ev.data));
          if (!frame || typeof frame.type !== "string") return;
          // Any frame proves the socket is alive — most importantly the
          // server's app-level pong answering our ping.
          this.missedPings = 0;
          const set = this.listeners.get(frame.type as DownloadSocketEvent);
          if (set) {
            for (const cb of set) {
              try {
                cb(frame.payload ?? {});
              } catch (err) {
                console.warn("[dl-socket] listener error:", err);
              }
            }
          }
        } catch {
          // Non-JSON frame — ignore.
        }
      };

      ws.onclose = () => {
        this.stopPingLoop();
        if (this.disposed) return;
        this.state = "reconnecting";
        this.scheduleReconnect();
      };

      ws.onerror = () => {
        // close always follows error; nothing else to do here.
      };
    } catch {
      this.state = "reconnecting";
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.attempts, RECONNECT_MAX_MS);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start();
    }, delay);
  }

  private startPingLoop() {
    this.stopPingLoop();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // If the server has not answered the previous ping(s) with any
        // frame, the socket is presumed dead: force close and let onclose
        // schedule the reconnect.
        if (this.missedPings >= MAX_MISSED_PINGS) {
          try {
            this.ws.close();
          } catch {}
          return;
        }
        this.missedPings += 1;
        try {
          this.ws.send(JSON.stringify({ type: "ping" }));
        } catch {
          try {
            this.ws.close();
          } catch {}
        }
        // missedPings resets to 0 in onmessage when the pong (or any frame)
        // arrives — see connect().
      }
    }, PING_INTERVAL_MS);
  }

  private stopPingLoop() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Subscribe to a download event. Returns an unsubscribe function,
   * mirroring the shape of the IPC listeners in preload.cjs.
   */
  on(type: DownloadSocketEvent, cb: Listener): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(cb);
    return () => {
      set?.delete(cb);
    };
  }

  dispose() {
    this.disposed = true;
    this.stopPingLoop();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
    this.listeners.clear();
  }
}

/** Singleton — one socket per renderer, started lazily inside the EXE. */
export const downloadSocket = new DownloadSocketClient();

/**
 * Subscribe a callback to download events over the WebSocket (preferred)
 * AND the classic IPC channel (always attached as the fallback path).
 * This double-registration is safe: main.cjs sends over exactly one channel
 * per event (WS when a client is attached, IPC otherwise).
 *
 * Returns a cleanup function detaching both listeners.
 */
export function addDownloadEventListener(
  type: DownloadSocketEvent,
  cb: Listener,
): () => void {
  const offs: Array<() => void> = [downloadSocket.on(type, cb)];

  const bridge = window.vidfetch;
  if (bridge) {
    if (type === "vidfetch:progress") offs.push(bridge.onProgress(cb));
    else if (type === "vidfetch:complete") offs.push(bridge.onComplete(cb));
    else if (type === "vidfetch:error") offs.push(bridge.onError(cb));
  }

  return () => offs.forEach((off) => off());
}
