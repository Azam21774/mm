const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mymail-send-lifecycle-'));
const previousDataDirectory = process.env.MYMAIL_DATA_DIR;
process.env.MYMAIL_DATA_DIR = directory;

// Keep the real command/send pipeline and real attachment files, while avoiding
// Chromium and every SMTP/OAuth/Gmail network operation.
const generatorPath = require.resolve('../utils/generateAttachments');
const previousGenerator = require.cache[generatorPath];
require.cache[generatorPath] = {
  id: generatorPath,
  filename: generatorPath,
  loaded: true,
  exports: async (recipients, _meta, _type, _sendAsPdf, events, _continue, _merge, output, onProgress) => {
    const report = (count, loading) => {
      const progress = { count, total: recipients.length, loading };
      events.emit('attachment', progress);
      onProgress(progress);
    };
    report(0, true);
    for (const recipient of recipients) {
      fs.writeFileSync(path.join(output, `${recipient.cid}.txt`), 'test attachment');
    }
    report(recipients.length, false);
  },
};
const backend = require('../index');

after(() => {
  if (previousGenerator) require.cache[generatorPath] = previousGenerator;
  else delete require.cache[generatorPath];
  if (previousDataDirectory === undefined) delete process.env.MYMAIL_DATA_DIR;
  else process.env.MYMAIL_DATA_DIR = previousDataDirectory;
  fs.rmSync(directory, { recursive: true, force: true });
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

for (const smtpType of ['APPPASS', 'API_HTTP']) {
  test(`${smtpType} keeps pending sends and attachments alive until completion, with working stop`, { timeout: 5000 }, async (t) => {
    const started = deferred();
    const pendingSend = deferred();
    let sendCalls = 0;
    const send = () => {
      sendCalls += 1;
      started.resolve();
      return pendingSend.promise;
    };
    t.after(() => pendingSend.resolve({}));

    t.mock.method(nodemailer, 'createTransport', () => ({ verify: async () => true, sendMail: send }));
    t.mock.method(google.auth, 'OAuth2', function () {
      this.setCredentials = () => {};
      this.getAccessToken = async () => ({ token: 'test-token' });
    });
    t.mock.method(google, 'gmail', () => ({ users: { messages: { send } } }));

    const jobId = `pending-${smtpType}`;
    const counts = [];
    const attachments = [];
    const onCount = (event) => { if (event.jobId === jobId) counts.push(event); };
    const onAttachment = (event) => { if (event.jobId === jobId) attachments.push(event); };
    backend.events.on('count', onCount);
    backend.events.on('attachment', onAttachment);
    t.after(() => {
      backend.events.off('count', onCount);
      backend.events.off('attachment', onAttachment);
    });

    let settled = false;
    const result = backend.execute('sendMails', {
      smtpType,
      jobId,
      smtpRotation: 'sequential',
      attachmentType: 'TXT',
      filename: '{{cid}}',
      smtps: [{ auth: { user: 'sender@example.invalid', pass: 'test-password' } }],
      apiAccounts: [{ user: 'sender@example.invalid', pass: 'test-refresh', clientId: 'test-client', clientSecret: 'test-secret' }],
      list: [
        { cid: 'first', email: 'first@example.invalid' },
        { cid: 'second', email: 'second@example.invalid' },
      ],
    }).then((response) => { settled = true; return response; });

    assert.equal(await Promise.race([
      started.promise.then(() => 'started'),
      result.then(() => 'returned'),
    ]), 'started', 'The command must wait for the actual mail operation');
    await new Promise(setImmediate);
    assert.equal(settled, false);
    assert.equal(sendCalls, 1, 'A sequential job must not start its next recipient yet');
    const jobsDirectory = path.join(directory, 'attachments');
    const jobDirectories = fs.readdirSync(jobsDirectory);
    assert.equal(jobDirectories.length, 1);
    assert.equal(fs.readFileSync(path.join(jobsDirectory, jobDirectories[0], 'first.txt'), 'utf8'), 'test attachment');
    assert.deepEqual(counts, []);
    assert.deepEqual(attachments.map(({ count, total, loading }) => ({ count, total, loading })), [
      { count: 0, total: 2, loading: true },
      { count: 2, total: 2, loading: false },
    ]);

    assert.equal((await backend.execute('stopJob', { jobId })).status, 200);
    pendingSend.resolve({});
    const response = await result;
    await new Promise(setImmediate);
    assert.equal(response.status, 200);
    assert.equal(response.data.msg, '2 recipients processed - sending stopped');
    assert.equal(sendCalls, 1, 'Stop must prevent the queued recipient from sending');
    assert.deepEqual(counts.map(({ processCount, errorCount, listLength }) => ({ processCount, errorCount, listLength })), [
      { processCount: 1, errorCount: 0, listLength: 2 },
      { processCount: 2, errorCount: 1, listLength: 2 },
    ]);
    assert.deepEqual(fs.readdirSync(jobsDirectory), []);
    assert.equal((await backend.execute('stopJob', { jobId })).status, 404);
  });
}
