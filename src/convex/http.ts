import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";

const http = httpRouter();

auth.addHttpRoutes(http);

// Proxy endpoint for downloading videos — bypasses CORS restrictions
http.route({
  path: "/proxy-download",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
      return new Response(
        JSON.stringify({ error: "Missing 'url' query parameter" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        },
      });

      if (!response.ok) {
        return new Response(
          JSON.stringify({ error: `Failed to fetch: ${response.statusText}` }),
          {
            status: response.status,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const contentType = response.headers.get("content-type") || "application/octet-stream";
      const contentDisposition = response.headers.get("content-disposition");
      const contentLength = response.headers.get("content-length");

      // Determine filename
      let filename = "download";
      if (contentDisposition) {
        const match = contentDisposition.match(/filename\*?=(?:UTF-8'')?["']?(.+?)["']?(?:;|$)/i);
        if (match) filename = match[1];
      } else if (contentType.startsWith("video/")) {
        const ext = contentType.split("/")[1] || "mp4";
        filename = `video.${ext}`;
      }

      const blob = await response.blob();

      return new Response(blob, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": contentLength || String(blob.size),
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown error",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }),
});

export default http;
