// Run with: npm run test:electron
// Uses an isolated profile and a mocked license service; never sends mail.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mymail-electron-ipc-'));
app.setPath('userData', path.join(directory, 'profile'));
process.env.MYMAIL_DATA_DIR = path.join(directory, 'data');
// No live licensing request or activation is made by this test process.
require('axios').post = async () => ({ data: { license: { key: 'smoke-test', username: 'smoke-test' } } });
const server = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><title>IPC smoke test</title><main>IPC smoke test</main>');
});
let finished = false;
const finish = (error) => {
  if (finished) return;
  finished = true;
  if (error) console.error(error);
  else console.log('Electron IPC smoke test passed');
  clearTimeout(deadline);
  server.close();
  app.once('will-quit', () => {
    fs.rmSync(directory, { recursive: true, force: true });
    app.exit(error ? 1 : 0);
  });
  app.quit();
};
const deadline = setTimeout(() => finish(new Error('Electron smoke test timed out')), 30000);
app.once('browser-window-created', (_event, window) => {
  window.hide();
  window.webContents.once('did-finish-load', async () => {
    try {
      const run = (source) => window.webContents.executeJavaScript(source);
      assert.equal(await run('typeof window.desktopBackend.sendMails'), 'function');
      assert.equal(await run('typeof window.require'), 'undefined');
      assert.equal((await run('window.desktopBackend.listFiles()')).status, 401);
      const status = await run('window.desktopLicense.redeem("smoke-test", "smoke-test")');
      assert.equal(status.active, true);
      assert.equal('localApiUrl' in status.license, false);
      assert.equal((await run('window.desktopBackend.uploadAttachment({ name: "ipc.txt", bytes: new Uint8Array([65, 66]) })')).status, 200);
      assert.deepEqual((await run('window.desktopBackend.listFiles()')).data.files, [{ name: 'ipc.txt' }]);
      await run(`window.seen = []; window.unsubscribe = window.desktopBackend.on('count', (payload) => window.seen.push(payload)); true;`);
      window.webContents.send('backend:event:count', { jobId: 'smoke', processCount: 1 });
      assert.deepEqual(await run('window.seen'), [{ jobId: 'smoke', processCount: 1 }]);
      await run('window.unsubscribe()');
      window.webContents.send('backend:event:count', { processCount: 2 });
      assert.equal(await run('window.seen.length'), 1);
      assert.equal(await run(`(() => { try { window.desktopBackend.on('unknown', () => {}); return false; } catch { return true; } })()`), true);
      const stranger = new BrowserWindow({ show: false, webPreferences: { preload: path.resolve(__dirname, '../preload.js'), contextIsolation: true, nodeIntegration: false } });
      await stranger.loadURL(process.env.ELECTRON_DEV_SERVER_URL);
      const denied = await stranger.webContents.executeJavaScript('window.desktopBackend.listFiles().then(() => false, () => true)');
      assert.equal(denied, true);
      stranger.destroy();
      await run('window.desktopBackend.deleteAttachments()');
      // An older in-flight validation must not undo a subsequent logout/clear.
      let releaseValidation;
      let validationStarted;
      const started = new Promise((resolve) => { validationStarted = resolve; });
      require('axios').post = () => new Promise((resolve) => {
        releaseValidation = () => resolve({ data: { license: { key: 'smoke-test' } } });
        validationStarted();
      });
      await run('window.pendingValidation = window.desktopLicense.getStatus(); true;');
      await started;
      await run('window.desktopLicense.clear()');
      releaseValidation();
      assert.equal((await run('window.pendingValidation')).active, false);
      assert.equal((await run('window.desktopBackend.listFiles()')).status, 401);
      finish();
    } catch (error) { finish(error); }
  });
});
server.listen(0, '127.0.0.1', () => {
  process.env.ELECTRON_DEV_SERVER_URL = `http://127.0.0.1:${server.address().port}`;
  const alreadyReady = app.isReady();
  require('../electron-main');
  if (alreadyReady) app.emit('ready');
});
