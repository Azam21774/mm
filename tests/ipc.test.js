const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorkerClient } = require('../ipc/worker-client');
const { createCommandService } = require('../ipc/command-service');

function fakeWorker() {
  const child = new EventEmitter();
  child.connected = true;
  child.sent = [];
  child.send = (message, callback) => { child.sent.push(message); callback?.(); };
  child.kill = () => { child.connected = false; };
  return child;
}

test('command replies can acknowledge background work; errors still clean up', async () => {
  const service = createCommandService();
  let release;
  let cleaned = false;
  service.register('background', async (_payload, reply) => {
    reply.once('finish', () => { cleaned = true; });
    reply.send({ started: true });
    await new Promise((resolve) => { release = resolve; });
  });
  assert.deepEqual(await service.execute('background'), { status: 200, data: { started: true } });
  assert.equal(cleaned, false);
  release();
  await new Promise(setImmediate);
  assert.equal(cleaned, true);
  service.register('fail', (_payload, reply) => {
    reply.once('finish', () => { cleaned = true; });
    throw new Error('failed');
  });
  cleaned = false;
  await assert.rejects(service.execute('fail'), /failed/);
  await new Promise(setImmediate);
  assert.equal(cleaned, true);
  await assert.rejects(service.execute('unknown'), /Unknown command/);
});

test('concurrent worker requests correlate replies and events; subscriptions are allowlisted', async () => {
  const child = fakeWorker();
  const received = [];
  const client = new WorkerClient('unused', { forkWorker: () => child, onEvent: (...args) => received.push(args) });
  const ready = client.start();
  assert.equal(client.start(), ready);
  child.emit('message', { type: 'ready' });
  await ready;
  const first = client.request('listFiles');
  const second = client.request('listBrowsers');
  await new Promise(setImmediate);
  const [a, b] = child.sent;
  child.emit('message', { type: 'response', id: b.id, result: { data: 'second' } });
  child.emit('message', { type: 'event', name: 'count', payload: { jobId: 'job-1' } });
  child.emit('message', { type: 'event', name: 'arbitrary', payload: {} });
  child.emit('message', { type: 'response', id: a.id, result: { data: 'first' } });
  assert.deepEqual(await first, { data: 'first' });
  assert.deepEqual(await second, { data: 'second' });
  assert.deepEqual(received, [['count', { jobId: 'job-1' }]]);
  await assert.rejects(client.request('arbitrary'), /Unknown/);
  await assert.rejects(client.request('listFiles', {}, 5), /timed out/);
  assert.equal(client.pending.size, 0);
  const interrupted = client.request('sendMails');
  await new Promise(setImmediate);
  child.emit('exit', 1);
  await assert.rejects(interrupted, /interrupted/);
  assert.equal(client.pending.size, 0);
  await assert.rejects(client.request('listFiles'), /unavailable/);
});

test('startup failure and shutdown reject pending startup instead of hanging', async () => {
  const child = fakeWorker();
  const client = new WorkerClient('unused', { forkWorker: () => child, startupTimeout: 5 });
  await assert.rejects(client.start(), /startup timed out/);
  assert.equal(child.connected, false);
  const other = fakeWorker();
  const stopped = new WorkerClient('unused', { forkWorker: () => other });
  const ready = stopped.start();
  stopped.stop();
  await assert.rejects(ready, /stopped/);
});

test('real worker: binary attachment roundtrip, validation, parallel requests, restart', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mymail-ipc-test-'));
  const previous = process.env.MYMAIL_DATA_DIR;
  process.env.MYMAIL_DATA_DIR = directory;
  const client = new WorkerClient(path.resolve(__dirname, '../server-process.js'));
  try {
    await client.start();
    const bytes = new Uint8Array([0, 1, 128, 255]);
    const result = await client.request('uploadAttachment', { name: 'sample.bin', bytes });
    assert.equal(result.status, 200);
    const [files, browsers] = await Promise.all([client.request('listFiles'), client.request('listBrowsers')]);
    assert.deepEqual(files.data.files, [{ name: 'sample.bin' }]);
    assert.deepEqual(browsers.data.chromeList, []);
    assert.deepEqual(fs.readFileSync(path.join(directory, 'attach', 'sample.bin')), Buffer.from(bytes));
    assert.equal((await client.request('uploadAttachment', { name: '../escape', bytes })).status, 400);
    assert.equal((await client.request('setBrowserSending', { port: 1, enabled: true })).status, 404);
    assert.equal((await client.request('verifyAccount', { smtpType: 'invalid' })).status, 400);
    assert.equal((await client.request('stopJob', { jobId: 'missing' })).status, 404);
    assert.equal((await client.request('sendMails', { smtpType: 'BROWSER' })).status, 400);
    // Exercise attachment preparation without credentials or recipients, so no
    // mail is sent. Image PDF modes also traverse the linked-PDF preparation.
    const progress = [];
    client.onEvent = (name, payload) => {
      if (name === 'attachment' && payload.jobId) progress.push(payload);
    };
    for (const attachmentType of ['PDF', 'PDFIMAGE', 'PDFIMAGEPNG']) {
      const jobId = `attachment-${attachmentType}`;
      const response = await client.request('sendMails', {
        smtpType: 'APPPASS', smtps: [], list: [], attachmentType, jobId,
      });
      assert.equal(response.status, 200, response.data.msg);
      assert.equal(response.data.msg, 'No Accounts/Smtp connected or ready');
      assert.deepEqual(progress.filter((event) => event.jobId === jobId), [
        { count: 0, total: 0, loading: true, jobId },
        { count: 0, total: 0, loading: false, jobId },
      ]);
    }
    await assert.rejects(client.request('listFiles', null), /payload/);
    await client.request('deleteAttachments');
    assert.deepEqual((await client.request('listFiles')).data.files, []);
    client.stop();
    await client.start();
    assert.deepEqual((await client.request('listFiles')).data.files, []);
  } finally {
    client.stop();
    if (previous === undefined) delete process.env.MYMAIL_DATA_DIR;
    else process.env.MYMAIL_DATA_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
