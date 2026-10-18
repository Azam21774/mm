const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');


const isDev = !app.isPackaged && process.env.MYMAIL_DEV_MODE === '1';

// Every running instance gets its own Chromium session folder (storage, cache,
// locks) so several copies can run side by side. Slots are stable: a new
// instance takes the lowest slot whose owner process is gone, so each slot
// keeps its own saved settings between runs. license.json stays in userData.
function claimSessionSlot() {
  const fsSync = require('fs');
  const root = path.join(app.getPath('userData'), 'instances');
  fsSync.mkdirSync(root, { recursive: true });
  const isAlive = (pid) => {
    try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
  };
  for (let slot = 0; slot < 200; slot += 1) {
    const dir = path.join(root, `slot-${slot}`);
    const lock = path.join(dir, 'owner.pid');
    fsSync.mkdirSync(dir, { recursive: true });
    try {
      const owner = Number(fsSync.readFileSync(lock, 'utf8'));
      if (owner && owner !== process.pid && isAlive(owner)) continue;
    } catch { /* no owner recorded */ }
    fsSync.writeFileSync(lock, String(process.pid));
    return dir;
  }
  return null;
}
try {
  const sessionDir = claimSessionSlot();
  if (sessionDir) app.setPath('sessionData', sessionDir);
} catch (error) {
  console.error('Unable to claim an instance session slot:', error);
}

// Windows groups taskbar buttons by AppUserModelID. A unique ID per process
// gives every launched instance its own taskbar button instead of one group.
if (process.platform === 'win32') {
  app.setAppUserModelId(`com.mymail.gmailapitool.${process.pid}`);
}
const devFrontendUrl = process.env.ELECTRON_DEV_SERVER_URL || 'http://127.0.0.1:3000';

let mainWindow;


const express = require('express');
const fs = require('fs');
const axios = require('axios');
const http = require('http');
const { randomUUID } = require('crypto');




const expressApp = express();


// Each running desktop process gets isolated working files. User-facing
// settings remain in the frontend's per-port local storage.
if (!process.env.MYMAIL_DATA_DIR) {
  process.env.MYMAIL_DATA_DIR = path.join(app.getPath('temp'), `mymail-runtime-${process.pid}`);
}

const { WorkerClient } = require('./ipc/worker-client');
const { commands } = require('./ipc/commands');
const LICENSE_API_BASE = 'https://ougnvhvbejiibxtdrdld.supabase.co/functions/v1/license-api';
let instance = false;
let licenseGeneration = 0;
let frontendServer;
let packagedFrontendUrl;
let licenseValidationTimer;
// Keep Puppeteer, document generation and sending off the main event loop.
const worker = new WorkerClient(path.join(__dirname, 'server-process.js'), {
  onEvent: (name, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(`backend:event:${name}`, payload);
  },
  onExit: () => {
    instance = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop-license:status-changed', { active: false });
    }
  },
});

async function start() {
  await worker.start();
  if (!worker.child) throw new Error('Backend worker failed to start.');
  instance = true;
}

async function stop() {
  instance = false;
  worker.stop();
}

function assertDesktopSender(event) {
  const expected = isDev ? devFrontendUrl : packagedFrontendUrl;
  if (!mainWindow || event.sender !== mainWindow.webContents
      || event.senderFrame !== mainWindow.webContents.mainFrame
      || !expected || new URL(event.senderFrame.url).origin !== new URL(expected).origin) {
    throw new Error('Untrusted IPC sender');
  }
}

for (const command of commands) {
  ipcMain.handle(`backend:${command}`, async (event, payload) => {
    assertDesktopSender(event);
    if (!instance || !worker.child) return { status: 503, data: { msg: 'Backend is not ready. Restart the application and try again.' } };
    try { return await worker.request(command, payload); }
    catch (error) { return { status: 503, data: { msg: error.message } }; }
  });
}

const licenseFile = () => path.join(app.getPath('userData'), 'license.json');

function readLicenseData() {
  try {
    return JSON.parse(fs.readFileSync(licenseFile(), 'utf8'));
  } catch {
    return null;
  }
}

function writeLicenseData(data) {
  fs.mkdirSync(path.dirname(licenseFile()), { recursive: true });
  fs.writeFileSync(licenseFile(), JSON.stringify(data));
}

async 
const OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000;
const LICENSE_RECHECK_MS = 5 * 60 * 1000;

function licenseFile() {
  return path.join(app.getPath('userData'), 'license.json');
}

function readLicenseData() {
  try {
    return JSON.parse(fs.readFileSync(licenseFile(), 'utf8'));
  } catch {
    return null;
  }
}

function writeLicenseData(data) {
  fs.mkdirSync(path.dirname(licenseFile()), { recursive: true });
  const temp = `${licenseFile()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(temp, licenseFile());
}

function getDeviceIdentity() {
  const saved = readLicenseData();
  if (saved?.deviceId) {
    return {
      deviceId: saved.deviceId,
      deviceName: saved.deviceName || `${process.platform} desktop`,
    };
  }

  const device = {
    deviceId: randomUUID(),
    deviceName: `${process.platform} desktop`,
  };
  writeLicenseData(device);
  return device;
}

async function clearLicenseActivation() {
  licenseGeneration += 1;
  const device = getDeviceIdentity();
  writeLicenseData({ ...device, token: null, username: null, expiresAt: null, lastValidatedAt: null });
  await stop();
  mainWindow?.webContents.send('desktop-license:status-changed', { active: false });
}

function publicLicense(data) {
  if (!data?.username) return null;
  return { username: data.username, expiresAt: data.expiresAt || null };
}

function isExplicitLicenseRejection(status) {
  return status === 401 || status === 403 || status === 409;
}

async function synchronizeDesktopLicense(licenseKey, username, mode = 'validate') {
  const generation = ++licenseGeneration;
  const saved = readLicenseData() || {};
  const device = getDeviceIdentity();

  try {
    let response;

    if (mode === 'activate') {
      if (typeof licenseKey !== 'string' || !licenseKey.trim() ||
          typeof username !== 'string' || !username.trim()) {
        return { active: false, error: 'Username and license key are required.' };
      }

      response = await axios.post(`${LICENSE_API_BASE}/api/license/activate`, {
        username: username.trim(),
        licenseKey: licenseKey.trim(),
        deviceId: device.deviceId,
      }, { timeout: 10000 });

      if (generation !== licenseGeneration) return { active: false };
      if (!response.data?.success || !response.data?.token) {
        return { active: false, error: 'Activation response did not contain a token.' };
      }

      const data = {
        ...device,
        token: response.data.token,
        username: response.data.username || username.trim(),
        expiresAt: response.data.expiresAt || null,
        lastValidatedAt: Date.now(),
      };
      writeLicenseData(data);
      await start();
      if (generation !== licenseGeneration) {
        await stop();
        return { active: false };
      }
      mainWindow?.webContents.send('desktop-license:status-changed', {
        active: true, license: publicLicense(data),
      });
      return { active: true, license: publicLicense(data) };
    }

    if (!saved.token) {
      await stop();
      return { active: false };
    }

    response = await axios.post(`${LICENSE_API_BASE}/api/license/validate`, {
      token: saved.token,
    }, { timeout: 10000 });

    if (generation !== licenseGeneration) return { active: false };
    if (!response.data?.success) {
      await clearLicenseActivation();
      return { active: false, error: 'License validation failed.' };
    }

    const data = {
      ...device,
      token: saved.token,
      username: response.data.username || saved.username,
      expiresAt: response.data.expiresAt || saved.expiresAt || null,
      lastValidatedAt: Date.now(),
    };
    writeLicenseData(data);
    await start();
    if (generation !== licenseGeneration) {
      await stop();
      return { active: false };
    }

    const result = { active: true, license: publicLicense(data) };
    mainWindow?.webContents.send('desktop-license:status-changed', result);
    return result;
  } catch (error) {
    if (generation !== licenseGeneration) return { active: false };

    const status = error.response?.status;

    if (isExplicitLicenseRejection(status)) {
      await clearLicenseActivation();
      return {
        active: false,
        error: error.response?.data?.error || 'License is invalid, expired, revoked, or bound to another device.',
      };
    }

    // Grace is allowed only after a previous successful validation.
    const lastValidatedAt = Number(saved.lastValidatedAt || 0);
    const graceAllowed = saved.token &&
      lastValidatedAt > 0 &&
      Date.now() >= lastValidatedAt &&
      Date.now() - lastValidatedAt <= OFFLINE_GRACE_MS;

    if (graceAllowed) {
      try {
        await start();
        const result = {
          active: true,
          offlineGrace: true,
          license: publicLicense(saved),
        };
        mainWindow?.webContents.send('desktop-license:status-changed', result);
        return result;
      } catch (startError) {
        await stop();
        return { active: false, error: startError.message };
      }
    }

    await stop();
    return {
      active: false,
      error: error.response?.data?.error || 'Cannot validate license. Connect to the internet and try again.',
    };
  }
}

ipcMain.handle('desktop-license:redeem', (event, key, username) => {
  assertDesktopSender(event);
  return synchronizeDesktopLicense(key, username, 'activate');
});

ipcMain.handle('desktop-license:get-status', (event) => {
  assertDesktopSender(event);
  const saved = readLicenseData();
  if (!saved?.token) return Promise.resolve({ active: false });
  return synchronizeDesktopLicense(null, null, 'validate');
});

// The documented API has no device-unbind endpoint. This clears local credentials only.
ipcMain.handle('desktop-license:deactivate', async (event) => {
  assertDesktopSender(event);
  await clearLicenseActivation();
  return {
    active: false,
    error: 'License cleared on this computer only. Contact the administrator to release the server-side device binding.',
  };
});

ipcMain.handle('desktop-license:clear', async (event) => {
  assertDesktopSender(event);
  await clearLicenseActivation();
  return { active: false };
});


// Static frontend hosting only; backend commands and license checks use IPC.
expressApp.use(express.static(path.join(__dirname, 'out')));

// Start server
function startPackagedFrontend() {
  if (isDev) return Promise.resolve(devFrontendUrl);
  if (packagedFrontendUrl) return Promise.resolve(packagedFrontendUrl);

  return new Promise((resolve, reject) => {
    const listen = (port) => {
      const candidate = expressApp.listen(port, '127.0.0.1');
      const handleError = (error) => {
        candidate.removeListener('listening', handleListening);
        if (error.code === 'EADDRINUSE') {
          listen(port + 1);
          return;
        }
        reject(error);
      };
      const handleListening = () => {
        candidate.removeListener('error', handleError);
        frontendServer = candidate;
        packagedFrontendUrl = `http://127.0.0.1:${port}`;
        console.log(`Frontend server listening on ${packagedFrontendUrl}`);
        resolve(packagedFrontendUrl);
      };

      candidate.once('error', handleError);
      candidate.once('listening', handleListening);
    };

    listen(54321);
  });
}





















async function createWindow() {
  const frontendUrl = await startPackagedFrontend();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    title: 'MyMail Manual',
  });

  

  await waitForFrontend(frontendUrl);
  await mainWindow.loadURL(frontendUrl);

  if (isDev) {
  //  mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function waitForFrontend(url, attempts = 60) {
  return new Promise((resolve, reject) => {
    const check = (remainingAttempts) => {
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          resolve();
          return;
        }
        retry(remainingAttempts);
      });

      request.on('error', () => retry(remainingAttempts));
      request.setTimeout(1000, () => {
        request.destroy();
        retry(remainingAttempts);
      });
    };

    const retry = (remainingAttempts) => {
      if (remainingAttempts <= 0) {
        reject(new Error(`Frontend did not start at ${url}`));
        return;
      }
      setTimeout(() => check(remainingAttempts - 1), 500);
    };

    check(attempts);
  });
}

app.on('ready', async () => {
  try {
    await createWindow();
    licenseValidationTimer = setInterval(async () => {
      const saved = readLicenseData();
      if (saved?.token) {
        await synchronizeDesktopLicense(null, null, 'validate');
      }
    }, LICENSE_RECHECK_MS);
    console.log('Desktop window ready. Backend remains locked until license validation.');
  } catch (error) {
    console.error('Failed to start desktop application:', error);
    worker.stop();
    dialog.showErrorBox('Mail System failed to start', String(error?.stack || error));
    app.quit();
  }
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (licenseValidationTimer) clearInterval(licenseValidationTimer);
  frontendServer?.close();
  worker.stop();
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});
