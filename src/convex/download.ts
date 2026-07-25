import { v } from "convex/values";
import { action } from "./_generated/server";

export const downloadVideo = action({
  args: {
    url: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const response = await fetch(args.url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || "application/octet-stream";
      const contentLength = response.headers.get("content-length");
      const contentDisposition = response.headers.get("content-disposition");

      // Extract filename from headers
      let filename = "video";
      if (contentDisposition) {
        const match = contentDisposition.match(/filename\*?=(?:UTF-8'')?["']?(.+?)["']?(?:;|$)/i);
        if (match) filename = match[1];
      }

      const arrayBuffer = await response.arrayBuffer();
      // Convert to base64 for transport
      const base64 = Buffer.from(arrayBuffer).toString("base64");

      return {
        success: true,
        data: base64,
        contentType,
        contentLength: contentLength ? parseInt(contentLength) : arrayBuffer.byteLength,
        filename,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },
});

export const getVideoMetadata = action({
  args: {
    url: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      // Do a HEAD request to check if the URL is a direct video/media file
      const response = await fetch(args.url, { method: "HEAD" });

      const contentType = response.headers.get("content-type") || "";
      const contentLength = response.headers.get("content-length");

      const isVideo = contentType.startsWith("video/");
      const isAudio = contentType.startsWith("audio/");
      const isImage = contentType.startsWith("image/");
      // Also accept application/octet-stream as it's common for downloads
      const isOctetStream = contentType === "application/octet-stream";

      let filename = "download";
      const contentDisposition = response.headers.get("content-disposition");
      if (contentDisposition) {
        const match = contentDisposition.match(/filename\*?=(?:UTF-8'')?["']?(.+?)["']?(?:;|$)/i);
        if (match) filename = match[1];
      }

      return {
        success: true,
        isDownloadable: isVideo || isAudio || isImage || isOctetStream,
        isVideo,
        isAudio,
        contentType,
        contentLength: contentLength ? parseInt(contentLength) : null,
        filename,
        url: args.url,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
        isDownloadable: false,
      };
    }
  },
});
