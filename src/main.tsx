import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "next-themes";
import { MotionConfig } from "framer-motion";
import React, { StrictMode, lazy, Suspense, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import { startupCleanup } from "@/lib/auto-cleanup";
import { requestNotificationPermission } from "@/lib/notification-permission";
import { SettingsProvider, useAppSettings } from "@/hooks/use-app-settings";
import { applySettings, loadSettings } from "@/lib/app-settings";
import PageTransition from "@/components/PageTransition";
import "./index.css";

// NOTE: The app-account login/signup system (Convex auth) was removed on
// purpose — VidFetch is a fully on-device downloader with no accounts. The
// yt-dlp "cookies import" feature (advanced YouTube troubleshooting) is NOT
// login and remains available.

// The account system (Convex) was removed with the auth feature; this only
// stays so a stale .env entry cannot break the bundle.
void import.meta.env.VITE_CONVEX_URL;

const Landing = lazy(() => import("./pages/Landing.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const ChatPage = lazy(() => import("./components/ClaudeStyleChat.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const LegalPage = lazy(() => import("./pages/LegalPage.tsx"));

function RouteLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

/** Silent error boundary kept for future dev-only overlays. */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[Overlay] Caught error, overlay disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[WebContainer preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);
  return null;
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <RouteSyncer />
      {/* Page transitions between routes. Inside Dashboard the tab switch
          has its own (shorter) animation, so this one stays quiet enough
          not to double up when the island changes tabs — it only fires on a
          real URL change. */}
      <Suspense fallback={<RouteLoading />}>
        <PageTransition>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/chat" element={<ChatPage />} />
            {/* The help center is rendered inline in the "Yardım" tab of the
                dashboard, so /help is no longer a route of its own. */}
            {/* Legal pages: /legal/privacy, /legal/terms, /legal/copyright */}
            <Route path="/legal/:doc" element={<LegalPage />} />
            {/* /auth was removed together with the account system — old links land on 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </PageTransition>
      </Suspense>
      <Toaster />
    </BrowserRouter>
  );
}

/**
 * Bridges the "Animasyonları kapat" switch into framer-motion.
 *
 * reducedMotion="always" makes every motion component jump straight to its
 * final state — no fades, no transforms — which is what a user who turned
 * animations off expects, and it also covers framer-motion's own exit
 * animations (the CSS layer in index.css cannot reach those).
 */
function MotionGate({ children }: { children: React.ReactNode }) {
  const { settings } = useAppSettings();
  return (
    <MotionConfig reducedMotion={settings.animations ? "user" : "always"}>
      {children}
    </MotionConfig>
  );
}

// ── Global safety: catch errors that slip past React error boundaries ──
// Prevents the WebView from going blank due to uncaught bridge/plugin errors.
if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => {
    const msg = e.message || "";
    const isBundle = msg.includes("SyntaxError") || msg.includes("Unexpected token");
    if (isBundle) {
      console.error("[Global] Fatal script error:", msg, e.filename);
    } else {
      console.warn("[Global] Non-fatal error:", msg);
    }
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.warn("[Global] Unhandled rejection (non-fatal):", msg);
  });
}

// Paint the saved look before React mounts, so an already-saved
// "düşük donanım modu" / "animasyonları kapat" never flashes the animated,
// blurred UI for a frame.
applySettings(loadSettings());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>{null}</ToolbarErrorBoundary>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        {/* Animation policy: default to the OS "reduce motion" setting
            ("user"), and force "always" when the user turns animations off
            in the Ayarlar tab — see MotionGate. */}
        <SettingsProvider>
          <MotionGate>
            <AppRoutes />
          </MotionGate>
        </SettingsProvider>
      </ThemeProvider>
    </RootErrorBoundary>
  </StrictMode>,
);

// Tell the inline watchdog in index.html that React mounted successfully,
// so it never paints a false "did not start" screen in the packaged apps.
((window as unknown as Record<string, unknown>)["__VIDFETCH_READY__"] as (() => void) | undefined)?.();

// Run auto-cleanup of orphan temp files on startup (non-blocking)
void startupCleanup;
void requestNotificationPermission;
