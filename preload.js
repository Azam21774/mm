const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopLicense", {
  redeem: (key, username) => ipcRenderer.invoke("desktop-license:redeem", key, username),
  getStatus: () => ipcRenderer.invoke("desktop-license:get-status"),
  deactivate: () => ipcRenderer.invoke("desktop-license:deactivate"),
  clear: () => ipcRenderer.invoke("desktop-license:clear"),
  onStatusChanged: (listener) => {
    const callback = (_event, status) => listener(status);
    ipcRenderer.on("desktop-license:status-changed", callback);
    return () => ipcRenderer.removeListener("desktop-license:status-changed", callback);
  },
});

// Each method maps to one allowed operation. Electron event objects never cross
// the context bridge; every subscription returns its own cleanup function.
const backendApi = {};
backendApi.uploadAttachment = (payload = {}) => ipcRenderer.invoke("backend:uploadAttachment", payload);
backendApi.listFiles = (payload = {}) => ipcRenderer.invoke("backend:listFiles", payload);
backendApi.deleteAttachments = (payload = {}) => ipcRenderer.invoke("backend:deleteAttachments", payload);
backendApi.verifyAccount = (payload = {}) => ipcRenderer.invoke("backend:verifyAccount", payload);
backendApi.startChrome = (payload = {}) => ipcRenderer.invoke("backend:startChrome", payload);
backendApi.listBrowsers = (payload = {}) => ipcRenderer.invoke("backend:listBrowsers", payload);
backendApi.setBrowserSending = (payload = {}) => ipcRenderer.invoke("backend:setBrowserSending", payload);
backendApi.stopJob = (payload = {}) => ipcRenderer.invoke("backend:stopJob", payload);
backendApi.setSenderName = (payload = {}) => ipcRenderer.invoke("backend:setSenderName", payload);
backendApi.sendDrafts = (payload = {}) => ipcRenderer.invoke("backend:sendDrafts", payload);
backendApi.closeBrowser = (payload = {}) => ipcRenderer.invoke("backend:closeBrowser", payload);
backendApi.sendMails = (payload = {}) => ipcRenderer.invoke("backend:sendMails", payload);
backendApi.on = (name, listener) => {
  if (!['browser-list', 'attachment', 'smtp', 'count', 'errorlog'].includes(name)
      || typeof listener !== 'function') throw new Error('Invalid backend subscription');
  const channel = `backend:event:${name}`;
  const callback = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, callback);
  return () => ipcRenderer.removeListener(channel, callback);
};
contextBridge.exposeInMainWorld('desktopBackend', backendApi);
