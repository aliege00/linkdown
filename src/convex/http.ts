import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

// Note: The video download proxy has been replaced by the self-hosted
// yt-dlp server (see yt-dlp-server/). The frontend communicates with
// the yt-dlp server directly for video info extraction and downloads.

export default http;
