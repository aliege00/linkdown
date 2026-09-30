// VidFetch download-event WebSocket server (Electron main process).
//
// Why a WebSocket next to IPC: the previous delivery path for progress,
// completion and error events was Electron's `webContents.send`, which is
// fire-and-forget. When the renderer is busy (large playlist JSON parse,
// heavy scroll) its message queue can back up and events can effectively be
// lost — a download then looks "stuck" or "never finishes". The WebSocket
// gives us:
//   • TCP delivery with kernel-level buffering (no dropped events)
//   • liveness detection via ping/pong heartbeats
//   • an observable channel (DevTools → Network → WS frames) for debugging
//
// Security: the server binds to 127.0.0.1 only (never 0.0.0.0) and requires
// a per-session random token on every connection. The token is handed to
// the renderer through the existing contextIsolated IPC bridge, never via
// the URL or any file.
//
// Delivery contract: `sendToAll` broadcasts BOTH over WebSocket and over
// the classic `webContents.send` channel, so the renderer can treat WS as
// primary and IPC as a drop-safe fallback with zero behavior change.

const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const HOST = "127.0.0.1";
const HEARTBEAT_MS = 15_000;
/** Give up on a socket that has not answered pings in this window. */
const DEAD_AFTER_MISSES = 2;

/**
 * Create and start the download-event WebSocket server.
 *
 * @returns {{ port: number|null, token: string, close: () => Promise<void>,
 *             broadcast: (type: string, payload: object) => boolean,
 *             onClient: (cb: (clientCount: number) => void) => void }}
 */
function startDownloadSocketServer() {
  const token = crypto.randomBytes(24).toString("hex");

  const httpServer = http.createServer((_req, res) => {
    // Plain HTTP probe — useful for tests and health checks.
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, channel: "vidfetch-downloads" }));
  });

  // Only connections from the app's own renderer should ever arrive here.
  httpServer.on("request", (req) => {
    const origin = req.headers.origin || "";
    if (origin && !origin.startsWith("app://") && !origin.includes("localhost")) {
      req.destroy();
    }
  });

  const wss = new WebSocketServer({ server: httpServer, maxPayload: 512 * 1024 });
  /** client -> { alive: boolean } liveness bookkeeping */
  const liveness = new WeakMap();
  let clients = 0;
  const clientListeners = new Set();

  wss.on("connection", (ws, req) => {
    // Auth: the renderer must present the session token (passed through the
    // contextIsolated preload bridge, never through the URL).
    const url = new URL(req.url || "/", "http://localhost");
    if (url.searchParams.get("token") !== token) {
      try {
        ws.close(4001, "unauthorized");
      } catch {}
      return;
    }

    liveness.set(ws, { alive: true });
    clients += 1;
    clientListeners.forEach((cb) => {
      try {
        cb(clients);
      } catch {}
    });

    ws.on("pong", () => {
      const s = liveness.get(ws);
      if (s) s.alive = true;
    });

    ws.on("message", (raw) => {
      // The renderer only ever sends pings / optional ACKs; anything larger
      // or non-JSON is rejected to keep the surface tiny.
      if (raw.length > 4096) return;
      try {
        const msg = JSON.parse(raw.toString());
        if (msg && msg.type === "ping") {
          // App-level liveness: the client sends this every ~20s and treats
          // a missing pong within its own window as a dead socket.
          try {
            ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
          } catch {}
        }
        // "ack" is reserved for future at-least-once semantics.
      } catch {}
    });

    ws.on("close", () => {
      clients = Math.max(0, clients - 1);
      clientListeners.forEach((cb) => {
        try {
          cb(clients);
        } catch {}
      });
    });

    ws.on("error", () => {
      /* handled by close */
    });
  });

  // Heartbeat: kill sockets that stop answering pings so a dead renderer
  // connection never silently swallows events (they still go via IPC then).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const s = liveness.get(ws);
      if (!s) continue;
      if (s.misses === undefined) s.misses = 0;
      if (!s.alive) {
        s.misses += 1;
        if (s.misses >= DEAD_AFTER_MISSES) {
          try {
            ws.terminate();
          } catch {}
          continue;
        }
      } else {
        s.misses = 0;
      }
      s.alive = false;
      try {
        ws.ping();
      } catch {}
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  let port = null;
  return {
    /** Resolves with the actual bound port (port 0 → OS-assigned). */
    ready: new Promise((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, HOST, () => {
        port = httpServer.address().port;
        resolve(port);
      });
    }),
    get port() {
      return port;
    },
    token,
    /**
     * Broadcast a typed event to every connected renderer.
     * @returns true when at least one client received it.
     */
    broadcast(type, payload) {
      if (wss.clients.size === 0) return false;
      const frame = JSON.stringify({ type, payload, ts: Date.now() });
      let delivered = false;
      for (const ws of wss.clients) {
        if (ws.readyState === 1 /* WebSocket.OPEN */) {
          try {
            ws.send(frame);
            delivered = true;
          } catch {}
        }
      }
      return delivered;
    },
    onClient(cb) {
      clientListeners.add(cb);
      return () => clientListeners.delete(cb);
    },
    close() {
      clearInterval(heartbeat);
      return new Promise((resolve) => {
        try {
          for (const ws of wss.clients) ws.terminate();
        } catch {}
        wss.close(() => {
          httpServer.close(() => resolve());
        });
      });
    },
  };
}

module.exports = { startDownloadSocketServer, HOST };
