function bridge() {
  if (typeof window === 'undefined' || !window.desktopBackend) {
    throw new Error('This operation is available only in the desktop app.');
  }
  return window.desktopBackend;
}

async function invoke(command, payload = {}) {
  const response = await bridge()[command](payload);
  if (response.status >= 400) {
    const error = new Error(response.data?.msg || response.data?.message || 'Desktop operation failed');
    error.response = response;
    throw error;
  }
  return response;
}

export const backend = {
  sendMails: (payload) => invoke('sendMails', payload),
  verifyAccount: (payload) => invoke('verifyAccount', payload),
  stopJob: (jobId) => invoke('stopJob', { jobId }),
  startChrome: () => invoke('startChrome'),
  listBrowsers: () => invoke('listBrowsers'),
  setSenderName: (port, senderName) => invoke('setSenderName', { port, senderName }),
  setBrowserSending: (port, enabled) => invoke('setBrowserSending', { port, enabled }),
  sendDrafts: (port) => invoke('sendDrafts', { port }),
  closeBrowser: (port) => invoke('closeBrowser', { port }),
  listFiles: () => invoke('listFiles'),
  deleteAttachments: () => invoke('deleteAttachments'),
  uploadAttachment: async (file) => {
    if (file.size > 100 * 1024 * 1024) throw new Error('Attachments must be 100 MB or smaller.');
    return invoke('uploadAttachment', { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  },
  subscriptions: () => {
    const cleanups = [];
    return {
      on: (name, listener) => { cleanups.push(bridge().on(name, listener)); },
      dispose: () => { cleanups.splice(0).forEach((cleanup) => cleanup()); },
    };
  },
};
