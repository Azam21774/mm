const {
  ensureDataDirectoriesExist,
  getAttachDir,
  getAttachmentsDir,
  getBaseDataDir,
  getPdfDir,
} = require('./dataPaths');

const ensureDirectoriesExist = () => {
  ensureDataDirectoriesExist();
  const result = {
    baseDataDir: getBaseDataDir(),
    attachDir: getAttachDir(),
    attachmentsDir: getAttachmentsDir(),
    pdfDir: getPdfDir(),
  };
  console.log('Directory check completed');
  return result;
};

module.exports = {
  ensureDirectoriesExist,
  getAttachDir,
  getAttachmentsDir,
  getBaseDataDir,
  getPdfDir,
};