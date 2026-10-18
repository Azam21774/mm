// Shared allowlist for the desktop bridge and worker. No arbitrary channels or paths.
const commands = Object.freeze([
  'uploadAttachment', 'listFiles', 'deleteAttachments', 'verifyAccount',
  'startChrome', 'listBrowsers', 'setBrowserSending', 'stopJob',
  'setSenderName', 'sendDrafts', 'closeBrowser', 'sendMails',
]);
const events = Object.freeze(['browser-list', 'attachment', 'smtp', 'count', 'errorlog']);
module.exports = { commands, events };
