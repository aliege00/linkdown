// VidFetch desktop preload — exposes a small, safe API to the web app.
// contextIsolation stays ON; only this explicit surface is bridged.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vidfetch", {
  isDesktop: true,

  getVideoInfo: (url) => ipcRenderer.invoke("vidfetch:getInfo", { url }),
  startDownload: (options) =>
    ipcRenderer.invoke("vidfetch:startDownload", options),
  cancelDownload: (token) => ipcRenderer.invoke("vidfetch:cancel", { token }),
  openFile: (filePath) => ipcRenderer.invoke("vidfetch:openFile", { filePath }),
  getDownloads: () => ipcRenderer.invoke("vidfetch:getDownloads"),
  getDownloadLocation: () => ipcRenderer.invoke("vidfetch:getLocation"),
  pickFolder: () => ipcRenderer.invoke("vidfetch:pickFolder"),
  resetDownloadLocation: () => ipcRenderer.invoke("vidfetch:resetLocation"),

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
