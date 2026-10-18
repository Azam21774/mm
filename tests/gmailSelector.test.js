const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  resolveSendButtonSelector,
  prepareAttachmentForUpload,
  classifyGmailSendFeedback,
  sanitizeAttachmentFilename,
  shouldAutoAcceptGmailDialog,
} = require('../utils/BrowserSmtp');
const { extractEmailFromText } = require('../index.js');

const selectors = resolveSendButtonSelector();

assert.ok(selectors.includes('div[role="button"][data-tooltip="Send"]'));
assert.ok(selectors.includes('div[role="button"][aria-label="Send"]'));
assert.ok(selectors.includes('div[role="button"].aoO.v7'));

assert.equal(sanitizeAttachmentFilename('report/with:bad*chars?.pdf'), 'with_bad_chars_.pdf');
assert.equal(sanitizeAttachmentFilename('  My Invoice  .pdf '), 'My Invoice .pdf');
assert.equal(
  shouldAutoAcceptGmailDialog('mail.google.com says Note: there were errors attaching your file(s). Send this message without these attachments?'),
  false,
);
assert.equal(shouldAutoAcceptGmailDialog('This website is asking to access your clipboard.'), true);
assert.equal(extractEmailFromText('Inbox (53) - foryou223377@gmail.com - Gmail'), 'foryou223377@gmail.com');
assert.equal(extractEmailFromText('Google Account: Test.User+demo@gmail.com'), 'Test.User+demo@gmail.com');
assert.equal(classifyGmailSendFeedback('Message sent').status, 'success');
assert.equal(classifyGmailSendFeedback("You have reached a limit for sending mail").status, 'failure');
assert.equal(classifyGmailSendFeedback("Message not sent. Check your network and try again.").status, 'failure');
assert.equal(classifyGmailSendFeedback("Message could not be sent. Check your network and try again.").status, 'failure');
assert.equal(classifyGmailSendFeedback("Message sent. Message could not be sent. Check your network and try again.").status, 'failure');
assert.equal(classifyGmailSendFeedback("Oops... the system encountered a problem (#2008) - Retrying in 3:32...").status, 'failure');
assert.equal(classifyGmailSendFeedback("Connecting in 1s... Try now").status, 'failure');
assert.equal(classifyGmailSendFeedback("Reconnecting in 10 sec").status, 'failure');
assert.equal(classifyGmailSendFeedback('Inbox refreshed'), null);

const sourceDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'attachment-source-test-'));
const sourcePath = path.join(sourceDirectory, 'generated.pdf');
fs.writeFileSync(sourcePath, 'browser attachment isolation');
const firstUpload = prepareAttachmentForUpload({ path: sourcePath, filename: 'invoice.pdf' });
const secondUpload = prepareAttachmentForUpload({ path: sourcePath, filename: 'invoice.pdf' });
assert.notEqual(firstUpload.tempDir, secondUpload.tempDir);
assert.equal(fs.readFileSync(firstUpload.uploadPath, 'utf8'), 'browser attachment isolation');
assert.equal(fs.readFileSync(secondUpload.uploadPath, 'utf8'), 'browser attachment isolation');
fs.rmSync(firstUpload.tempDir, { recursive: true, force: true });
fs.rmSync(secondUpload.tempDir, { recursive: true, force: true });
fs.rmSync(sourceDirectory, { recursive: true, force: true });

console.log('gmail selector test passed');
