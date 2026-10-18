const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const puppeteer = require('puppeteer');
const path = require('path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sendLocks = new Map();

async function acquireSendLock(port) {
  const previousLock = sendLocks.get(port) || Promise.resolve();
  let releaseLock;
  const currentLock = new Promise((resolve) => {
    releaseLock = resolve;
  });

  const queuedLock = previousLock.then(() => currentLock);
  sendLocks.set(port, queuedLock);
  await previousLock;

  return () => {
    releaseLock();
    if (sendLocks.get(port) === queuedLock) {
      sendLocks.delete(port);
    }
  };
}
function resolveChromePath() {
  const platform = os.platform();

  if (platform === 'win32') {
    const candidates = [
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];

    const existing = candidates.find((candidate) => candidate && fs.existsSync(candidate));
    if (!existing) {
      throw new Error('Google Chrome executable was not found on this Windows machine.');
    }
    return existing;
  }

  if (platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }

  if (platform === 'linux') {
    return 'google-chrome';
  }

  throw new Error(`Unsupported operating system: ${platform}`);
}

function launchChromeWithDebugging(port, startupUrl = 'https://mail.google.com/') {
  const chromePath = resolveChromePath();
  const profileDir = path.join(os.tmpdir(), `_chrome_profile_${port}`);
  fs.mkdirSync(profileDir, { recursive: true });
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    // Fresh Chrome profiles otherwise open with Chrome's small default page
    // area (~800×600). The fallback size also covers platforms where Chrome
    // declines the maximize request during startup.
    '--start-maximized',
    '--window-size=1440,900',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion',
    startupUrl,
  ];

  console.log(`Launching Chrome on port ${port}...`);

  const chromeProcess = spawn(chromePath, args, {
    detached: true,
    stdio: 'ignore',
  });

  chromeProcess.on('error', (error) => {
    console.error(`Error launching Chrome: ${error.message}`);
  });

  chromeProcess.unref();

  console.log(`Chrome started successfully (PID: ${chromeProcess.pid})`);
  return chromeProcess;
}

async function waitForDebugPort(port = 9222, timeoutMs = 10000) {
  const endpoints = [
    `http://127.0.0.1:${port}/json/version`,
    `http://localhost:${port}/json/version`,
  ];
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint);
        if (response.ok) {
          return;
        }
      } catch {
        // Chrome is not ready yet.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for Chrome debugging endpoint at ${endpoints[0]}`);
}

async function connectToDebugBrowser(port) {
  const versionUrl = `http://127.0.0.1:${port}/json/version`;
  const response = await fetch(versionUrl);
  if (!response.ok) {
    throw new Error(`Failed to read Chrome DevTools version from ${versionUrl}`);
  }

  const version = await response.json();
  const wsEndpoint = version.webSocketDebuggerUrl;

  if (!wsEndpoint || typeof wsEndpoint !== 'string') {
    throw new Error(`Chrome DevTools endpoint missing webSocketDebuggerUrl at ${versionUrl}`);
  }

  const normalizedWsEndpoint = wsEndpoint.replace('ws://localhost:', 'ws://127.0.0.1:');

  return puppeteer.connect({
    browserWSEndpoint: normalizedWsEndpoint,
    // Puppeteer defaults to an emulated 800×600 viewport when it attaches to
    // a browser. These are real, visible Gmail windows, so preserve Chrome's
    // native viewport instead of shrinking the rendered page inside a large
    // native window.
    defaultViewport: null,
  });
}

// connectToDebugBrowser() opens a brand-new DevTools WebSocket connection
// (and re-walks every open target) on every call. sendWithGmail/sendNextDraft
// used to connect and disconnect once per email, which meant every single
// send paid a full CDP handshake on top of the actual Gmail automation -
// real overhead when several Browser SMTP windows are sending in parallel
// through the same Node process. Keep one persistent connection per debug
// port instead, reused for that window's whole lifetime, and only reconnect
// when none is cached yet or the cached one has died.
const debugBrowserConnections = new Map();

async function getDebugBrowserConnection(port) {
  const cached = debugBrowserConnections.get(port);
  if (cached) {
    try {
      const browser = await cached;
      if (browser.isConnected()) return browser;
    } catch {
      // Cached connection attempt failed; fall through and reconnect below.
    }
    if (debugBrowserConnections.get(port) === cached) {
      debugBrowserConnections.delete(port);
    }
  }

  const connectionPromise = connectToDebugBrowser(port).catch((error) => {
    if (debugBrowserConnections.get(port) === connectionPromise) {
      debugBrowserConnections.delete(port);
    }
    throw error;
  });

  debugBrowserConnections.set(port, connectionPromise);
  return connectionPromise;
}

// Drops (and disconnects) the cached connection for a port, e.g. because the
// Chrome window is being closed, or a send failed in a way that suggests the
// connection itself is no longer good and the next attempt should reconnect
// fresh instead of reusing it.
function forgetDebugBrowserConnection(port) {
  const cached = debugBrowserConnections.get(port);
  debugBrowserConnections.delete(port);
  if (!cached) return;
  cached.then((browser) => browser.disconnect()).catch(() => {});
}

async function maximizeDebugBrowserWindow(browser) {
  const pages = await browser.pages();
  const page = pages.find((candidate) => candidate.url().startsWith('https://mail.google.com/')) || pages[0];
  if (!page) return false;

  const session = await page.target().createCDPSession();
  try {
    // Browser-level resizing keeps Gmail's real viewport in sync with its
    // native Chrome window. Do not use page.setViewport here: that enables
    // device emulation and can leave unused space around Gmail.
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'maximized' },
    });
    await session.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined);
    return true;
  } finally {
    await session.detach().catch(() => undefined);
  }
}

async function waitForTitleWords(page, requiredWords = ['Inbox', 'Gmail'], timeoutMs) {
  await page.waitForFunction(
    (words) => words.every((word) => document.title.includes(word)),
    { timeout: timeoutMs },
    requiredWords,
  );

  return page.title();
}

function sanitizeAttachmentFilename(filename) {
  const rawBase = path.basename(String(filename || 'attachment'));
  const sanitized = rawBase
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '_');

  return sanitized || 'attachment';
}

function resolveSendButtonSelector() {
  return [
    'div[role="button"][data-tooltip="Send"]',
    'div[role="button"][aria-label="Send"]',
    'div[role="button"][aria-label*="Send"]',
    'button[aria-label="Send"]',
    'div[role="button"].aoO.v7',
    'div[role="button"].T-I-atl',
  ];
}

function shouldAutoAcceptGmailDialog(message = '') {
  const normalized = String(message || '').trim();
  if (!normalized) {
    return true;
  }

  const blockedPatterns = [
    /there were errors attaching your file\(s\)/i,
    /send this message without these attachments/i,
    /attachment.*(failed|did not attach|could not be attached|could not be added)/i,
    /could not attach/i,
  ];

  return !blockedPatterns.some((pattern) => pattern.test(normalized));
}

const resolveRecipientSelector = async (page, timeout = 30000, composeSelector = null) => {
  const selectors = [
    'input[peoplekit-id]',
    'input[name="to"]',
    'input[aria-label="To recipients"]',
    'textarea[aria-label="To recipients"]',
    'input[aria-label="Recipients"]',
    'textarea[aria-label="Recipients"]',
    'input[placeholder="Recipients"]',
    'textarea[placeholder="Recipients"]',
    'input[aria-label="To"]',
    'input[aria-label*="To"]',
    'input[aria-label*="Recipients"]',
    '[contenteditable="true"][aria-label="To recipients"]',
    '[contenteditable="true"][aria-label="To"]',
    '[contenteditable="true"][role="combobox"]',
    'input[role="combobox"]',
    '.vO',
  ];

  await page.waitForFunction(
    ({ candidateSelectors, activeComposeSelector }) => {
      const root = activeComposeSelector ? document.querySelector(activeComposeSelector) : document;
      if (!root) return false;
      return candidateSelectors.some((selector) => {
      const element = root.querySelector(selector);
      if (!element) return false;
      const bounds = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return bounds.width > 0
        && bounds.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none';
      });
    },
    { timeout },
    { candidateSelectors: selectors, activeComposeSelector: composeSelector },
  );

  for (const selector of selectors) {
    const element = await page.$(composeSelector ? `${composeSelector} ${selector}` : selector);
    if (element && await element.isVisible()) return selector;
  }

  throw new Error('Gmail recipient field was not visible after compose opened');
};

const expandRecipientField = async (page, composeSelector = null) => {
  const recipientRowSelectors = [
    '[aria-label="To recipients"]',
    '[aria-label="Recipients"]',
    '[placeholder="Recipients"]',
    '[contenteditable="true"][aria-label="To recipients"]',
    '[contenteditable="true"][aria-label="To"]',
    '[contenteditable="true"][role="combobox"]',
    'input[role="combobox"]',
    '.vO',
    'input[name="to"]',
  ];

  return page.evaluate(({ selectors, activeComposeSelector }) => {
    const root = activeComposeSelector ? document.querySelector(activeComposeSelector) : document;
    if (!root) return false;
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && element.getBoundingClientRect().width > 0
        && element.getBoundingClientRect().height > 0;
    };

    for (const selector of selectors) {
      const element = Array.from(root.querySelectorAll(selector)).find(isVisible);
      if (element) {
        element.click();
        return true;
      }
    }

    const toLabel = Array.from(root.querySelectorAll('div, span')).find((element) =>
      isVisible(element) && element.textContent.trim() === 'To',
    );
    if (toLabel) {
      toLabel.click();
      return true;
    }

    return false;
  }, { selectors: recipientRowSelectors, activeComposeSelector: composeSelector });
};

function prepareAttachmentForUpload(attachment) {
  if (!attachment?.path) {
    throw new Error('Attachment path is required for browser upload.');
  }

  const sourcePath = path.resolve(attachment.path);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Attachment file does not exist: ${sourcePath}`);
  }

  const desiredName = sanitizeAttachmentFilename(
    attachment.filename ? attachment.filename : path.basename(sourcePath)
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-upload-'));
  const uploadPath = path.join(tempDir, desiredName);

  fs.copyFileSync(sourcePath, uploadPath);

  return {
    uploadPath,
    tempDir,
    cleanup: true,
  };
}

function classifyGmailSendFeedback(text) {
  const message = String(text || '').replace(/\s+/g, ' ').trim();
  if (!message) return null;
  if (/message not sent|message could not be sent|could(?: not|n't) send|failed to send|error sending|try again|system encountered a problem|(?:retrying|connecting|reconnecting)\s+in\s+\d+\s*(?:s|sec|seconds?)\b|trying to reconnect|sending limit|reached (?:a |your )?limit|rate limit|quota|blocked the send|errors? attaching|attachment.*(?:failed|error)/i.test(message)) {
    return { status: 'failure', message };
  }
  if (/message sent|email sent|sent successfully/i.test(message)) return { status: 'success', message };
  return null;
}

const gmailFeedbackSelectors = ['[role="alert"]', '[role="status"]', '[aria-live="assertive"]', '[aria-live="polite"]', '.bAq', '.vh', '.Kj-JD-Jz'];

function createGmailFlowError(message, code, options = {}) {
  const error = new Error(message);
  error.code = code;
  error.stopBrowserJob = options.stopBrowserJob !== false;
  error.sendAttempted = options.sendAttempted === true;
  return error;
}

async function visibleGmailFeedback(page) {
  return page.evaluate((selectors) => {
    const isVisible = (element) => {
      if (!element) return false;
      const bounds = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };

    return Array.from(document.querySelectorAll(selectors.join(',')))
      .filter(isVisible)
      .map((element, index) => {
        if (!element.dataset.mymailFeedbackId) {
          element.dataset.mymailFeedbackId = `mymail-feedback-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;
        }
        return { id: element.dataset.mymailFeedbackId, text: (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim() };
      })
      .filter((entry) => entry.text);
  }, gmailFeedbackSelectors);
}

function freshFeedbackEntries(entries, baseline = []) {
  const before = new Set(baseline.map((entry) => `${entry.id}\u0000${entry.text}`));
  return entries.filter((entry) => !before.has(`${entry.id}\u0000${entry.text}`));
}

async function waitForStaleSuccessFeedbackToClear(page, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entries = await visibleGmailFeedback(page);
    if (!entries.some((entry) => classifyGmailSendFeedback(entry.text)?.status === 'success')) return entries;
    await sleep(200);
  }
  throw createGmailFlowError('A previous Gmail “Message sent” notice is still visible. Sending paused to avoid counting it for the next recipient.', 'GMAIL_STALE_SUCCESS_NOTICE');
}

async function activeComposeId(page, mark = false) {
  return page.evaluate((shouldMark) => {
    const isVisible = (element) => {
      if (!element) return false;
      const bounds = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const isCompose = (element) => element.querySelector('input[name="subjectbox"], div[role="textbox"].Am.Al.editable, input[peoplekit-id], [aria-label="To recipients"]');
    const candidates = Array.from(document.querySelectorAll('.aoI, .AD, [role="dialog"]')).filter(isVisible).filter(isCompose);
    const compose = candidates.at(-1);
    if (!compose) return null;
    if (!shouldMark) return 'open';
    if (!compose.dataset.mymailComposeId) {
      compose.dataset.mymailComposeId = `mymail-compose-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    return compose.dataset.mymailComposeId;
  }, mark);
}

async function waitForActiveCompose(page, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const composeId = await activeComposeId(page, true);
    if (composeId) return `[data-mymail-compose-id="${composeId}"]`;
    await sleep(100);
  }
  throw createGmailFlowError('Gmail did not open a compose window. Sending paused.', 'GMAIL_COMPOSE_NOT_OPEN');
}

async function waitForEnabledComposeSendButton(page, composeSelector, timeoutMs = 60000) {
  const selectors = resolveSendButtonSelector();
  try {
    const handle = await page.waitForFunction(({ activeComposeSelector, candidateSelectors }) => {
      const compose = document.querySelector(activeComposeSelector);
      if (!compose) return false;
      const isVisible = (element) => {
        if (!element) return false;
        const bounds = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const isEnabled = (element) => isVisible(element)
        && !element.disabled
        && element.getAttribute('aria-disabled') !== 'true'
        && !element.classList.contains('T-I-JW')
        && element.getAttribute('aria-busy') !== 'true';
      const uploading = Array.from(compose.querySelectorAll('[role="progressbar"], [aria-busy="true"], [data-uploading="true"]')).some(isVisible);
      const sendButton = candidateSelectors.flatMap((selector) => Array.from(compose.querySelectorAll(selector))).find(isEnabled);
      if (!sendButton || uploading) return false;

      const now = Date.now();
      const readyAt = Number(sendButton.dataset.mymailReadyAt || 0);
      if (!readyAt) {
        sendButton.dataset.mymailReadyAt = String(now);
        return false;
      }
      return now - readyAt >= 800 ? sendButton : false;
    }, { timeout: timeoutMs }, { activeComposeSelector: composeSelector, candidateSelectors: selectors });
    const sendButton = handle.asElement();
    if (!sendButton) {
      await handle.dispose();
      throw new Error('Gmail Send button was not an element.');
    }
    return sendButton;
  } catch (error) {
    if (error?.stopBrowserJob) throw error;
    throw createGmailFlowError('Gmail is still preparing the message or attachment. The message was left open and sending paused.', 'GMAIL_COMPOSE_NOT_READY');
  }
}

async function refreshGmailWindow(port) {
  let page = null;
  const confirmReload = async (dialog) => {
    try {
      await dialog.accept();
    } catch (error) {
      console.warn(`Unable to confirm Chrome reload dialog on port ${port}:`, error.message);
    }
  };
  try {
    await waitForDebugPort(port, 15000);
    const browser = await getDebugBrowserConnection(port);
    const pages = await browser.pages();
    page = pages.find((candidate) => candidate.url().startsWith('https://mail.google.com/')) ?? pages[0];
    if (!page) throw new Error('Gmail page was not found for refresh.');
    // Windows Chrome may show "Reload site? Changes that you made may not be
    // saved." for an open Gmail compose. Confirm only while this controlled
    // recovery refresh is running.
    page.on('dialog', confirmReload);
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch {
      await page.goto('https://mail.google.com/mail/u/0/#inbox', { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await page.waitForSelector('div[role="main"]', { visible: true, timeout: 30000 });
  } finally {
    if (page) page.off('dialog', confirmReload);
  }
}

// Browser-mode sending drives Gmail's own compose UI, which always uses the
// account's own "Send mail as" display name — mailOptions.from is meaningless
// here (only SMTP/Gmail API sending reads it). To actually control the sender
// name shown to recipients, we have to change that display name in Gmail's own
// Settings > Accounts and Import, the same way a person would by hand:
// gear icon -> Settings -> Accounts and Import -> "edit info" next to the
// account under "Send mail as" -> set a custom name -> Save Changes.
async function setGmailSenderNameUnlocked(port, senderName, expectedEmail = null) {
  const trimmedName = String(senderName || '').trim();
  if (!trimmedName) return { changed: false, reason: 'No sender name configured.' };

  await waitForDebugPort(port);
  const browser = await getDebugBrowserConnection(port);
  let handleDialog = null;
  let handleNewTarget = null;

  try {
    // Gmail's settings screen shows a native "Leave site? Changes that you
    // made may not be saved." confirm dialog on navigation. With nothing
    // listening for it, Puppeteer's page.goto() just hangs forever waiting on
    // it — which is exactly what made this look "stuck" even after the save
    // itself had already gone through. Auto-accept it everywhere, same as
    // refreshGmailWindow/sendWithGmailUnlocked already do for their own
    // navigations, and keep it attached to any popup this flow opens too.
    handleDialog = async (dialog) => {
      try { await dialog.accept(); } catch {}
    };
    const attachDialogHandler = (targetPage) => { if (targetPage) targetPage.on('dialog', handleDialog); };
    (await browser.pages()).forEach(attachDialogHandler);
    handleNewTarget = async (target) => {
      attachDialogHandler(await target.page().catch(() => null));
    };
    browser.on('targetcreated', handleNewTarget);

    const pages = await browser.pages();
    const page = pages.find((candidate) => candidate.url().startsWith('https://mail.google.com/'))
      ?? pages[0]
      ?? await browser.newPage();
    await page.bringToFront();

    await page.goto('https://mail.google.com/mail/u/0/#settings/accounts', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // The settings screen renders inside Gmail's classic (slower) settings
    // frame; wait for the "Send mail as" section rather than a fixed sleep.
    await page.waitForFunction(
      () => {
        const isVisible = (element) => {
          const bounds = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        };
        return Array.from(document.querySelectorAll('td, div, span, b'))
          .some((el) => isVisible(el) && el.textContent.trim() === 'Send mail as:');
      },
      { timeout: 30000 },
    );

    // Mark the target link with evaluate() (cheap, text-based search), but the
    // actual click must go through Puppeteer's native ElementHandle.click() —
    // a real CDP-dispatched mouse event, not a scripted el.click(). Gmail's
    // "edit info" opens a window.open() popup, and Chrome's popup blocker
    // silently swallows window.open() calls that aren't backed by genuine
    // user-activation; a plain in-page el.click() doesn't carry that, so the
    // editor would never appear no matter how well we search for it after.
    const editInfoMarked = await page.evaluate((email) => {
      const isVisible = (element) => {
        const bounds = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const editLinks = Array.from(document.querySelectorAll('a, span[role="link"]'))
        .filter((el) => isVisible(el) && /edit info/i.test(el.textContent.trim()));

      if (editLinks.length === 0) return false;

      // Prefer the row that mentions this account's own email address, in
      // case more than one identity is configured; otherwise use the first.
      const findRowText = (el) => {
        let node = el;
        for (let depth = 0; depth < 6 && node; depth += 1) {
          if (node.textContent && node.textContent.includes('@')) return node.textContent;
          node = node.parentElement;
        }
        return el.textContent || '';
      };

      const target = (email && editLinks.find((el) => findRowText(el).includes(email))) || editLinks[0];
      target.setAttribute('data-mymail-edit-info', 'true');
      return true;
    }, expectedEmail);

    if (!editInfoMarked) {
      throw createGmailFlowError('Could not find "edit info" under Send mail as in Gmail Settings.', 'GMAIL_SENDER_NAME_NO_EDIT_LINK');
    }

    const editInfoHandle = await page.$('[data-mymail-edit-info="true"]');
    if (!editInfoHandle) {
      throw createGmailFlowError('Could not find "edit info" under Send mail as in Gmail Settings.', 'GMAIL_SENDER_NAME_NO_EDIT_LINK');
    }
    await editInfoHandle.click();
    await editInfoHandle.dispose();

    // Gmail opens the identity editor as a real separate popup window (it has
    // its own titlebar reading "Gmail - Edit email address"), not an inline
    // panel. The Settings > Accounts and Import page itself ALSO matches a
    // generic "has Send mail as text + >=2 radios (the default-send-as picker)
    // + a visible text input (Gmail's own search box)" heuristic, so the old
    // search here could pick the settings page itself instead of the popup --
    // it would then fill/save nothing on the real editor, which stayed open
    // forever exactly as the user's screenshot showed. Require the popup's
    // distinctive title first, and never consider the settings `page` itself
    // a candidate.
    const isIdentityEditorTarget = async (target) => {
      try {
        return await target.evaluate(() => {
          const title = (document.title || '').toLowerCase();
          if (title.includes('edit email address') || title.includes('edit information')) return true;

          const bodyText = (document.body?.innerText || document.documentElement?.innerText || '').toLowerCase();
          const hasMarkerText = bodyText.includes('your name in google accounts') ||
            bodyText.includes('edit information for your email address');

          const hasCfnInput = Boolean(document.querySelector('input[name="cfn"], input[name="displayname"]'));
          const hasRadios = document.querySelectorAll('input[type="radio"]').length >= 2;
          const hasTextInput = Array.from(document.querySelectorAll('input')).some((el) => {
            const type = (el.getAttribute('type') || el.type || 'text').toLowerCase();
            return (type === 'text' || type === '') && !el.disabled;
          });

          return (hasMarkerText || hasCfnInput) && hasRadios && hasTextInput;
        });
      } catch {
        return false;
      }
    };

    let editorPage = null;
    let editorTarget = null;
    const editorSearchDeadline = Date.now() + 15000;

    while (Date.now() < editorSearchDeadline && !editorTarget) {
      const openPages = (await browser.pages()).filter((candidatePage) => candidatePage !== page);
      for (const candidatePage of openPages) {
        if (candidatePage.isClosed()) continue;

        const targets = [candidatePage, ...candidatePage.frames().filter((f) => f !== candidatePage.mainFrame())];
        for (const target of targets) {
          // eslint-disable-next-line no-await-in-loop
          if (await isIdentityEditorTarget(target)) {
            editorTarget = target;
            editorPage = candidatePage;
            break;
          }
        }
        if (editorTarget) break;
      }
      if (!editorTarget) await sleep(300);
    }

    if (!editorTarget) {
      throw createGmailFlowError('Could not find the Gmail identity editor popup window.', 'GMAIL_SENDER_NAME_NO_INPUT');
    }

    if (editorPage && typeof editorPage.bringToFront === 'function') {
      try { await editorPage.bringToFront(); } catch {}
    }

    // Step 1: Select the custom name radio and fill the new sender name
    const inputFilled = await editorTarget.evaluate((nameToApply) => {
      const allInputs = Array.from(document.querySelectorAll('input'));
      const textInput = document.querySelector('input[name="cfn"]') ||
        allInputs.find((el) => {
          const type = (el.getAttribute('type') || el.type || 'text').toLowerCase();
          return (type === 'text' || type === '') && !el.disabled;
        });

      if (!textInput) return false;

      textInput.focus();
      textInput.click();

      // Find the radio button corresponding to the custom name
      const customRadio = document.querySelector('input[name="displayname"][value="1"]') ||
        document.querySelector('input[name="displayname"][value="custom"]') ||
        (textInput.closest('tr') || textInput.closest('div') || textInput.parentElement)?.querySelector('input[type="radio"]') ||
        Array.from(document.querySelectorAll('input[type="radio"]')).pop();

      if (customRadio) {
        customRadio.checked = true;
        customRadio.click();
        customRadio.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Set input value cleanly
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(textInput, '');
        textInput.dispatchEvent(new Event('input', { bubbles: true }));
        nativeSetter.call(textInput, nameToApply);
        textInput.dispatchEvent(new Event('input', { bubbles: true }));
        textInput.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        textInput.value = nameToApply;
        textInput.dispatchEvent(new Event('input', { bubbles: true }));
        textInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      return true;
    }, trimmedName);

    if (!inputFilled) {
      throw createGmailFlowError('Could not find the custom sender name field in the Gmail identity editor.', 'GMAIL_SENDER_NAME_NO_INPUT');
    }

    await sleep(200);

    // Step 2: Trigger Save Changes / form submit
    let saveTriggered = false;

    // Try Puppeteer native click first if on page
    if (editorPage) {
      try {
        const nativeButton = await editorPage.$('input[name="nvp_bu_sub"], input[type="submit"], input[value="Save Changes"], button[type="submit"]');
        if (nativeButton) {
          await nativeButton.click();
          saveTriggered = true;
        }
      } catch {}
    }

    if (!saveTriggered) {
      saveTriggered = await editorTarget.evaluate(() => {
        const allButtons = Array.from(document.querySelectorAll('input[type="submit"], button, input[type="button"], div[role="button"]'));
        const saveButton = document.querySelector('input[name="nvp_bu_sub"]') ||
          allButtons.find((el) => {
            const text = (el.value || el.textContent || el.getAttribute('aria-label') || '').trim();
            if (/cancel/i.test(text)) return false;
            return /save\s*changes|save|next\s*step/i.test(text);
          });

        if (saveButton) {
          saveButton.focus();
          saveButton.click();
          const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
          saveButton.dispatchEvent(clickEvent);
          return true;
        }

        const form = document.querySelector('form');
        if (form) {
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
            return true;
          }
          form.submit();
          return true;
        }

        return false;
      });
    }

    if (!saveTriggered) {
      throw createGmailFlowError('Could not find the Save Changes button in the Gmail identity editor.', 'GMAIL_SENDER_NAME_NO_SAVE');
    }

    // Step 3: Wait for the save operation to complete (popup closes or navigates)
    if (editorPage && editorPage !== page) {
      const deadline = Date.now() + 10000;
      let isDone = false;
      while (Date.now() < deadline && !isDone) {
        if (editorPage.isClosed()) {
          isDone = true;
          break;
        }
        // If form is still present after 2 seconds, force requestSubmit/submit
        if (Date.now() > deadline - 7000) {
          try {
            await editorTarget.evaluate(() => {
              const form = document.querySelector('form');
              if (form) form.submit();
            });
          } catch {}
        }
        await sleep(300);
      }

      if (!editorPage.isClosed()) {
        try { await editorPage.close(); } catch {}
      }
    } else {
      await sleep(1500);
    }

    if (!page.isClosed()) {
      try {
        await page.bringToFront();
        await page.goto('https://mail.google.com/mail/u/0/#inbox', { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch {}
    }

    return { changed: true };
  } finally {
    if (handleDialog && browser) {
      if (handleNewTarget) browser.off('targetcreated', handleNewTarget);
      for (const connectedPage of await browser.pages().catch(() => [])) {
        connectedPage.off('dialog', handleDialog);
      }
    }
  }
}

async function waitForGmailSendConfirmation(page, getDialogError, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30000;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const baselineFeedback = options.baselineFeedback || [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const dialogError = getDialogError();
    if (dialogError) throw createGmailFlowError(dialogError, 'GMAIL_SEND_DIALOG', { sendAttempted: true });

    const feedback = freshFeedbackEntries(await visibleGmailFeedback(page), baselineFeedback)
      .map((entry) => ({ ...entry, result: classifyGmailSendFeedback(entry.text) }));
    const failure = feedback.find((entry) => entry.result?.status === 'failure');
    if (failure) {
      throw createGmailFlowError(`Gmail rejected the message: ${failure.result.message}`, 'GMAIL_SEND_REJECTED', { sendAttempted: true });
    }
    const success = feedback.find((entry) => entry.result?.status === 'success');
    if (success) return success.result.message;
    await sleep(pollIntervalMs);
  }
  throw createGmailFlowError('Gmail did not show a fresh “Message sent” confirmation. The compose was left open and sending paused.', 'GMAIL_SEND_UNCONFIRMED', { sendAttempted: true });
}

// The new sleep-free sending function
async function sendWithGmailUnlocked(port, mailOptions, uploadDelayOption = 0) {
  console.log('Starting sendWithGmail function...');

  let preparedAttachments = [];
  let browser = null;
  let handleGmailDialog = null;
  let handleNewTarget = null;
  let gmailDialogError = null;
  const uploadDelay = typeof uploadDelayOption === 'object'
    ? Number(uploadDelayOption.uploadDelay ?? 0)
    : Number(uploadDelayOption);

  await waitForDebugPort(port);

  browser = await getDebugBrowserConnection(port);
  try {
    const pages = await browser.pages();
    const page = pages.find((candidate) => candidate.url().startsWith('https://mail.google.com/'))
      ?? pages[0]
      ?? await browser.newPage();
    await page.bringToFront();

    handleGmailDialog = async (dialog) => {
      const message = dialog.message();

      if (shouldAutoAcceptGmailDialog(message)) {
        console.log(`Confirming Gmail dialog automatically: ${message}`);
        await dialog.accept();
        return;
      }

      gmailDialogError = `Gmail blocked the send: ${message}`;
      console.warn(gmailDialogError);
      await dialog.dismiss();
    };

    const attachDialogHandler = (targetPage) => {
      if (targetPage) targetPage.on('dialog', handleGmailDialog);
    };

    pages.forEach(attachDialogHandler);
    handleNewTarget = async (target) => {
      attachDialogHandler(await target.page());
    };
    browser.on('targetcreated', handleNewTarget);

    const loadingScreenSelector = '#loading';
    const composeSelector = 'div[role="button"][gh="cm"]';
    const waitForGmailReady = async () => {
      try {
        await page.waitForSelector(loadingScreenSelector, { hidden: true, timeout: 30000 });
      } catch {
        // Gmail may remove the loading element instead of hiding it.
      }
      await page.waitForSelector('div[role="main"]', { visible: true, timeout: 30000 });
    };
    const closeExistingComposeWindows = async () => {
      await page.evaluate(() => {
        const isVisible = (element) => {
          const bounds = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return bounds.width > 0
            && bounds.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden';
        };

        const composeWindows = Array.from(document.querySelectorAll('.aoI, [role="dialog"]'))
          .filter(isVisible)
          .filter((composeWindow) => composeWindow.querySelector(
            '[aria-label="Discard draft"], [data-tooltip="Discard draft"], [aria-label="Save & close"], [data-tooltip="Save & close"]',
          ));

        composeWindows.forEach((composeWindow) => {
          const discardButton = Array.from(composeWindow.querySelectorAll(
            '[aria-label="Discard draft"], [data-tooltip="Discard draft"]',
          )).find(isVisible);
          const closeButton = Array.from(composeWindow.querySelectorAll(
            '[aria-label="Save & close"], [data-tooltip="Save & close"]',
          )).find(isVisible);

          (discardButton || closeButton)?.click();
        });
      });

      try {
        await page.waitForFunction(
          () => !Array.from(document.querySelectorAll('.aoI, [role="dialog"]')).some((composeWindow) => {
            const bounds = composeWindow.getBoundingClientRect();
            const style = window.getComputedStyle(composeWindow);
            return bounds.width > 0
              && bounds.height > 0
              && style.display !== 'none'
              && style.visibility !== 'hidden'
              && composeWindow.querySelector(
                '[aria-label="Discard draft"], [data-tooltip="Discard draft"], [aria-label="Save & close"], [data-tooltip="Save & close"]',
              );
          }),
          { timeout: 10000 },
        );
      } catch {
        throw new Error('Existing Gmail Compose window did not close');
      }
    };
    const openCompose = async () => {
      await closeExistingComposeWindows();
      await page.waitForSelector(composeSelector, { visible: true, timeout: 30000 });
      await page.click(composeSelector);
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll('[role="dialog"], .AD, .aoI')).some((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.width > 0 && bounds.height > 0;
        }),
        { timeout: 10000 },
      );
      return expandRecipientField(page);
    };

    const resetToInbox = async () => {
      await page.goto('https://mail.google.com/mail/u/0/#inbox', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await waitForGmailReady();
    };

    await waitForGmailReady();
    await openCompose();

    // --- 3. Fill Out Email Details ---
    let toInputSelector;
    try {
      toInputSelector = await resolveRecipientSelector(page, 2000);
    } catch (recipientError) {
      console.warn(`Recipient field unavailable; refreshing Gmail before retry: ${recipientError.message}`);
      await resetToInbox();
      await openCompose();
      toInputSelector = await resolveRecipientSelector(page, 5000);
    }

    await page.click(toInputSelector);
    await page.type(toInputSelector, mailOptions.to || '');
    await page.keyboard.press('Enter');

    const subjectSelector = 'input[name="subjectbox"]';
    await page.waitForSelector(subjectSelector, { visible: true });
    await page.type(subjectSelector, mailOptions.subject || '');

    const bodySelector = 'div[role="textbox"].Am.Al.editable';
    await page.waitForSelector(bodySelector, { visible: true });

    const htmlBody = mailOptions.html || '';

    await page.evaluate((selector, html) => {
      const element = document.querySelector(selector);
      if (element) {
        if (window.trustedTypes && window.trustedTypes.createPolicy) {
          const escapeHTMLPolicy = window.trustedTypes.createPolicy('puppeteerPassThru', {
            createHTML: (string) => string
          });
          element.innerHTML = escapeHTMLPolicy.createHTML(html);
        } else {
          element.innerHTML = html;
        }
      }
    }, bodySelector, htmlBody);

 // --- 4. Attach File ---
    const attachmentsToUpload = (Array.isArray(mailOptions.attachments) ? mailOptions.attachments : [])
      .filter((attachment) => attachment?.path);

    if (attachmentsToUpload.length > 0) {
      const fileInputSelector = 'input[type="file"][name="Filedata"]';
      for (const attachment of attachmentsToUpload) {
        const prepared = prepareAttachmentForUpload(attachment);
        preparedAttachments.push(prepared);
        await page.waitForSelector(fileInputSelector);

        const fileInput = await page.$(fileInputSelector);
        await fileInput.uploadFile(prepared.uploadPath);
      }

      // With zero delay, wait for Gmail to finish the upload before sending.
      // A positive delay uses the configured attachment upload delay.
      if (uploadDelay === 0) {
        try {
          await page.waitForSelector('div[role="progressbar"]', { hidden: true, timeout: 30000 });
          const uploadIndicatorSelector = 'div[upload_id]';
          await page.waitForSelector(uploadIndicatorSelector, { hidden: true, timeout: 30000 });
        } catch (e) {
          console.warn('Attachment upload may not have completed successfully within the expected time frame.');
        }
      }
    } else {
      console.log('No attachment provided for browser upload.');
    }

    // --- 5. Click Send Button ---

    let matchedSelector = null;
    let fallbackSelector = 'div[role="button"].aoO.v7';

    if (uploadDelay === 0) {
      const selectors = resolveSendButtonSelector();
      for (const selector of selectors) {
        try {
          await page.waitForSelector(selector, { visible: true, timeout: 5000 });
          matchedSelector = selector;
          break;
        } catch {
          // Try next selector.
        }
      }
    } else {
      await sleep(uploadDelay);
      try {
        await page.waitForSelector(fallbackSelector, { visible: true, timeout: 5000 });
        matchedSelector = fallbackSelector;
      } catch {
        // Leave matchedSelector null and handle below.
      }
    }

    const selectorToClick = matchedSelector || fallbackSelector;
    try {
      await page.waitForSelector(selectorToClick, { visible: true, timeout: 5000 });
    } catch (e) {
      throw new Error('Send button element not found in DOM');
    }

    await page.evaluate((selector) => {
      const sendButton = document.querySelector(selector);
      if (sendButton) {
        sendButton.click();
      } else {
        throw new Error('Send button element not found in DOM');
      }
    }, selectorToClick);

    await waitForGmailSendConfirmation(page, () => gmailDialogError);

  } catch (error) {
    throw error;
  } finally {
    if (handleGmailDialog && browser) {
      if (handleNewTarget) {
        browser.off('targetcreated', handleNewTarget);
      }
      for (const connectedPage of await browser.pages()) {
        connectedPage.off('dialog', handleGmailDialog);
      }
    }

    for (const prepared of preparedAttachments) {
      if (prepared?.cleanup && prepared.tempDir) {
        fs.rmSync(prepared.tempDir, { recursive: true, force: true });
      }
    }

    // The connection itself is cached and reused across sends (see
    // getDebugBrowserConnection) instead of being disconnected here - only
    // sendWithGmail's retry path forgets it, if a failure suggests it's dead.
  }
}

async function sendWithGmail(port, mailOptions, uploadDelayOption = 0) {
  const releaseSendLock = await acquireSendLock(port);

  try {
    try {
      return await sendWithGmailUnlocked(port, mailOptions, uploadDelayOption);
    } catch (error) {
      const errorMessage = String(error?.message || error);
      const shouldRetry = /waiting failed|timeout|target closed|frame got detached|protocol error|execution context|system encountered a problem|message could not be sent|#2008|(?:retrying|connecting|reconnecting)\s+in\s+\d+\s*(?:s|sec|seconds?)\b|trying to reconnect/i
        .test(errorMessage);

      if (!shouldRetry) throw error;

      console.warn(`Gmail send interrupted; refreshing window ${port} before retry: ${errorMessage}`);
      // A "target closed"/"protocol error"/"frame got detached" failure means
      // the cached CDP connection itself may be stale - drop it so the
      // refresh below (and the retried send) reconnect fresh instead of
      // reusing a connection that's already broken.
      forgetDebugBrowserConnection(port);
      await refreshGmailWindow(port);
      await sleep(1000);
      return await sendWithGmailUnlocked(port, mailOptions, uploadDelayOption);
    }
  } finally {
    releaseSendLock();
  }
}

// Opens the Gmail Drafts folder, opens the first draft found, and sends it.
// Returns { done: true } once the Drafts folder is empty so the caller can
// stop looping.
async function sendNextDraftUnlocked(port) {
  await waitForDebugPort(port);

  const browser = await getDebugBrowserConnection(port);
  let handleGmailDialog = null;
  let handleNewTarget = null;
  let gmailDialogError = null;

  try {
    const pages = await browser.pages();
    const page = pages.find((candidate) => candidate.url().startsWith('https://mail.google.com/'))
      ?? pages[0]
      ?? await browser.newPage();
    await page.bringToFront();

    handleGmailDialog = async (dialog) => {
      const message = dialog.message();

      if (shouldAutoAcceptGmailDialog(message)) {
        console.log(`Confirming Gmail dialog automatically: ${message}`);
        await dialog.accept();
        return;
      }

      gmailDialogError = `Gmail blocked the send: ${message}`;
      console.warn(gmailDialogError);
      await dialog.dismiss();
    };

    const attachDialogHandler = (targetPage) => {
      if (targetPage) targetPage.on('dialog', handleGmailDialog);
    };

    pages.forEach(attachDialogHandler);
    handleNewTarget = async (target) => {
      attachDialogHandler(await target.page());
    };
    browser.on('targetcreated', handleNewTarget);

    await page.goto('https://mail.google.com/mail/u/0/#drafts', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('div[role="main"]', { visible: true, timeout: 30000 });

    const opened = await page.evaluate(() => {
      const isVisible = (element) => {
        const bounds = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const row = Array.from(document.querySelectorAll('tr.zA')).find(isVisible);
      if (!row) return false;
      row.click();
      return true;
    });

    if (!opened) return { done: true };

    const composeSelector = await waitForActiveCompose(page, 15000);
    const baselineFeedback = await visibleGmailFeedback(page);
    const sendButton = await waitForEnabledComposeSendButton(page, composeSelector, 60000);
    await sendButton.evaluate((element) => element.click());
    await waitForGmailSendConfirmation(page, () => gmailDialogError, { baselineFeedback });

    return { done: false };
  } finally {
    if (handleGmailDialog && browser) {
      if (handleNewTarget) {
        browser.off('targetcreated', handleNewTarget);
      }
      for (const connectedPage of await browser.pages()) {
        connectedPage.off('dialog', handleGmailDialog);
      }
    }
  }
}

async function sendNextDraft(port) {
  const releaseSendLock = await acquireSendLock(port);

  try {
    return await sendNextDraftUnlocked(port);
  } finally {
    releaseSendLock();
  }
}

// Shares the same per-window lock as sendWithGmail/sendNextDraft so this
// never navigates the Gmail tab away from an in-flight compose/send.
async function setGmailSenderName(port, senderName, expectedEmail = null) {
  const releaseSendLock = await acquireSendLock(port);

  try {
    return await setGmailSenderNameUnlocked(port, senderName, expectedEmail);
  } finally {
    releaseSendLock();
  }
}

module.exports = {
  resolveChromePath,
  launchChromeWithDebugging,
  waitForDebugPort,
  connectToDebugBrowser,
  getDebugBrowserConnection,
  forgetDebugBrowserConnection,
  maximizeDebugBrowserWindow,
  waitForTitleWords,
  prepareAttachmentForUpload,
  sanitizeAttachmentFilename,
  resolveSendButtonSelector,
  shouldAutoAcceptGmailDialog,
  classifyGmailSendFeedback,
  waitForGmailSendConfirmation,
  refreshGmailWindow,
  sendWithGmail,
  sendNextDraft,
  setGmailSenderName,
};
