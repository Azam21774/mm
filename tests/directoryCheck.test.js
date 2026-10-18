const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const originalDataDir = process.env.MYMAIL_DATA_DIR;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mymail-dirs-'));
const baseDir = path.join(tempRoot, 'custom-data');

process.env.MYMAIL_DATA_DIR = baseDir;

try {
  const { ensureDirectoriesExist, getAttachDir, getAttachmentsDir, getPdfDir } = require('../utils/directoryCheck');
  const checked = ensureDirectoriesExist();

  assert.equal(checked.baseDataDir, baseDir);
  assert.equal(checked.attachDir, path.join(baseDir, 'attach'));
  assert.equal(checked.attachmentsDir, path.join(baseDir, 'attachments'));
  assert.equal(checked.pdfDir, path.join(baseDir, 'pdf'));

  [getAttachDir(), getAttachmentsDir(), getPdfDir()].forEach((dir) => {
    assert.ok(fs.existsSync(dir), `Expected ${dir} to exist`);
  });

  console.log('directory check test passed');
} finally {
  if (originalDataDir === undefined) {
    delete process.env.MYMAIL_DATA_DIR;
  } else {
    process.env.MYMAIL_DATA_DIR = originalDataDir;
  }

  fs.rmSync(tempRoot, { recursive: true, force: true });
}
