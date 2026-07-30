import { v } from "convex/values";
import { action } from "./_generated/server";

/**
 * Optional: Proxy a download through the Convex backend.
 * This can be used as a fallback if direct access to the yt-dlp server
 * is restricted (e.g., in a locked-down network).
 *
 * The primary download path is now the self-hosted yt-dlp server.
 * See yt-dlp-server/ for deployment instructions.
 */

export const downloadVideo = action({
  args: {
    url: v.string(),
    ytdlpServerUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const serverUrl = args.ytdlpServerUrl;

    if (!serverUrl) {
      return {
        success: false,
        error:
          "No yt-dlp server URL provided. Deploy the server from yt-dlp-server/ and pass its URL.",
      };
    }

    try {
      // Forward to the yt-dlp server — it handles extraction & streaming
      const response = await fetch(
        `${serverUrl}/api/info?url=${encodeURIComponent(args.url)}`,
        { signal: AbortSignal.timeout(30000) },
      );

      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(
          err?.detail || `yt-dlp server responded with ${response.status}`,
        );
      }

      return await response.json();
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});
