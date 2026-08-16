// VidFetch desktop preload — exposes a small, safe API to the web app.
// contextIsolation stays ON; only this explicit surface is bridged.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vidfetch", {
  isDesktop: true,

  // NOTE: these take the options object straight from the renderer and pass it
  // through unchanged. Wrapping them again here (e.g. { url }) would double-
  // wrap the payload, turning the URL into an object that yt-dlp sees as
  // "[object Object] is not a valid URL".
  getVideoInfo: (options) => ipcRenderer.invoke("vidfetch:getInfo", options),
  startDownload: (options) =>
    ipcRenderer.invoke("vidfetch:startDownload", options),
  cancelDownload: (options) => ipcRenderer.invoke("vidfetch:cancel", options),
  openFile: (options) => ipcRenderer.invoke("vidfetch:openFile", options),
  getDownloads: () => ipcRenderer.invoke("vidfetch:getDownloads"),
  getDownloadLocation: () => ipcRenderer.invoke("vidfetch:getLocation"),
  pickFolder: () => ipcRenderer.invoke("vidfetch:pickFolder"),
  resetDownloadLocation: () => ipcRenderer.invoke("vidfetch:resetLocation"),

  // YouTube anti-bot settings (browser cookies, cookies.txt, PO token provider)
  getYouTubeSettings: () => ipcRenderer.invoke("vidfetch:getYouTubeSettings"),
  setCookiesBrowser: (browser) =>
    ipcRenderer.invoke("vidfetch:setCookiesBrowser", { browser }),
  pickCookieFile: () => ipcRenderer.invoke("vidfetch:pickCookieFile"),
  clearCookieFile: () => ipcRenderer.invoke("vidfetch:clearCookieFile"),
  setPoTokenProvider: (url) =>
    ipcRenderer.invoke("vidfetch:setPoTokenProvider", { url }),

  onProgress: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on("vidfetch:progress", listener);
    return () => ipcRenderer.removeListener("vidfetch:progress", listener);
  },
  onComplete: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on("vidfetch:complete", listener);
    return () => ipcRenderer.removeListener("vidfetch:complete", listener);
  },
  onError: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on("vidfetch:error", listener);
    return () => ipcRenderer.removeListener("vidfetch:error", listener);
  },
});
