const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ideogram", {
  systemInfo: () => ipcRenderer.invoke("system:info"),
  apiStatus: () => ipcRenderer.invoke("api:status"),
  listGallery: () => ipcRenderer.invoke("gallery:list"),
  doctor: () => ipcRenderer.invoke("generation:doctor"),
  generate: (payload) => ipcRenderer.invoke("generation:start", payload),
  openPath: (targetPath) => ipcRenderer.invoke("app:openPath", targetPath),
  showItem: (targetPath) => ipcRenderer.invoke("app:showItem", targetPath),
  copyText: (text) => ipcRenderer.invoke("app:copyText", text),
  trashItem: (targetPath) => ipcRenderer.invoke("app:trashItem", targetPath),
  onGenerationEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("generation:event", listener);
    return () => ipcRenderer.removeListener("generation:event", listener);
  },
  onWorkerLog: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("worker:log", listener);
    return () => ipcRenderer.removeListener("worker:log", listener);
  }
});
