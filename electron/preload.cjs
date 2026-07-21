const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jimsLauncher", {
  getInfo: () => ipcRenderer.invoke("launcher:get-info"),
  play: () => ipcRenderer.invoke("launcher:play"),
  check: () => ipcRenderer.invoke("launcher:check"),
  install: () => ipcRenderer.invoke("launcher:install"),
  quit: () => ipcRenderer.invoke("launcher:quit"),
  onStatus: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("launcher:status", handler);
    return () => ipcRenderer.removeListener("launcher:status", handler);
  },
});
