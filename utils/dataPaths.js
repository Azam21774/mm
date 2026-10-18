const fs = require('fs');
const os = require('os');
const path = require('path');

const getBaseDataDir = () => process.env.MYMAIL_DATA_DIR || path.join(os.homedir(), '.mymail-gmail-api-tool');
const getAttachDir = () => path.join(getBaseDataDir(), 'attach');
const getAttachmentsDir = () => path.join(getBaseDataDir(), 'attachments');
const getPdfDir = () => path.join(getBaseDataDir(), 'pdf');

const baseDataDir = getBaseDataDir();
const attachDir = getAttachDir();
const attachmentsDir = getAttachmentsDir();
const pdfDir = getPdfDir();

const ensureDataDirectoriesExist = () => {
  const dirs = [getBaseDataDir(), getAttachDir(), getAttachmentsDir(), getPdfDir()];
  dirs.forEach((directory) => {
    fs.mkdirSync(directory, { recursive: true });
  });
};

module.exports = {
  attachDir,
  attachmentsDir,
  baseDataDir,
  ensureDataDirectoriesExist,
  getAttachDir,
  getAttachmentsDir,
  getBaseDataDir,
  getPdfDir,
  pdfDir,
};