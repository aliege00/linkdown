/**
 * Build-time Convex backend guard.
 *
 * `VITE_CONVEX_URL` is baked in by Vite at build time. On CI (GitHub Actions)
 * it is usually empty, and `new ConvexReactClient("")` THROWS at module load —
 * which previously crashed the whole app before React rendered (white screen
 * in the APK). Constructing the client only when a real URL exists lets the
 * app run in offline mode: the landing page and on-device downloads work
 * without any backend, and auth is simply disabled.
 */
export const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined;

export const HAS_CONVEX = !!CONVEX_URL;
