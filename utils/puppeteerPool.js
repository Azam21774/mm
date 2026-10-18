const fs = require("fs");
const os = require("os");
const puppeteer = require("puppeteer");

function resolveChromeExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  if (process.platform !== "win32") {
    return undefined;
  }

  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ];

  if (process.execPath) {
    const exeDir = require("path").dirname(process.execPath);
    candidates.push(
      require("path").join(exeDir, "chrome.exe"),
      require("path").join(exeDir, "chrome-win", "chrome.exe")
    );
  }

  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function launchBrowser() {
  const chromeExecutablePath = resolveChromeExecutablePath();
  const launchOptions = {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  };

  if (chromeExecutablePath) {
    launchOptions.executablePath = chromeExecutablePath;
  }

  if (process.platform === "win32" && !chromeExecutablePath) {
    throw new Error(
      "Chrome not found for attachment generation. Install Google Chrome/Edge or set PUPPETEER_EXECUTABLE_PATH."
    );
  }

  return puppeteer.launch(launchOptions);
}

// A single headless Chromium instance, reused across every attachment job
// instead of one full browser process per job. Multiple concurrent send
// queues just open extra tabs on this one browser, which is far cheaper
// than each launching its own Chromium process.
let browserPromise = null;

async function getSharedBrowser() {
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      if (browser.isConnected()) return browser;
    } catch {
      // Fall through and relaunch below.
    }
    browserPromise = null;
  }

  browserPromise = launchBrowser().catch((error) => {
    browserPromise = null;
    throw error;
  });

  return browserPromise;
}

// A fixed-size pool of reusable pages, shared by every concurrent
// attachment-generation call (one per browser-SMTP send job). Jobs check a
// page out per recipient rather than for their whole run, so several send
// queues interleave and all keep making visible progress instead of one
// job hogging a slot until its entire batch finishes. The pool size caps
// how many pages render at once, bounding CPU/RAM regardless of how many
// jobs are active.
//
// The old hardcoded cap of 2 meant that on any machine with more than 3
// cores, running 3-4+ Browser SMTP windows that all generate attachments
// serialized down to just 2 concurrent renders no matter how much CPU
// headroom existed. Scale with the core count instead (reserving 2 cores
// for the OS and the visible Gmail browser windows themselves, which are
// already CPU-heavy), with a fixed upper bound so a beefy machine doesn't
// spawn dozens of concurrent Chromium renders. MYMAIL_ATTACHMENT_POOL_SIZE
// overrides this outright for manual tuning.
const POOL_SIZE_CAP = 6;
const POOL_SIZE = (() => {
  const override = Number(process.env.MYMAIL_ATTACHMENT_POOL_SIZE);
  if (Number.isInteger(override) && override > 0) return override;
  return Math.max(1, Math.min(os.cpus().length - 2, POOL_SIZE_CAP));
})();
let totalPages = 0;
const idlePages = [];
const waiters = [];

async function acquirePage() {
  for (;;) {
    while (idlePages.length > 0) {
      const page = idlePages.pop();
      if (!page.isClosed()) return page;
      totalPages -= 1; // Discard a dead page and try again below.
    }

    if (totalPages < POOL_SIZE) {
      totalPages += 1;
      try {
        const browser = await getSharedBrowser();
        return await browser.newPage();
      } catch (error) {
        totalPages -= 1;
        throw error;
      }
    }

    // Pool is fully checked out: wait for a release/discard to free a slot,
    // then loop back around and re-attempt acquisition from scratch.
    await new Promise((resolve) => waiters.push(resolve));
  }
}

function releasePage(page) {
  if (page.isClosed()) {
    totalPages -= 1;
  } else {
    idlePages.push(page);
  }
  const waiter = waiters.shift();
  if (waiter) waiter();
}

// Runs `task(page)` against a page from the shared pool, returning it (or
// discarding it, if it died) when done.
async function withPooledPage(task) {
  const page = await acquirePage();
  try {
    return await task(page);
  } finally {
    releasePage(page);
  }
}

// Headless Chrome's PDF printing (CDP Page.printToPDF, which page.pdf()
// calls) can hang indefinitely when invoked concurrently across multiple
// tabs/pages of the same browser instance — it isn't safe to run in
// parallel the way screenshots/setContent are. Everything else a job does
// can stay concurrent across pooled pages; only the actual print call is
// serialized process-wide here so concurrent recipients don't deadlock.
let printQueue = Promise.resolve();
function printPdf(page, options) {
  const run = printQueue.then(() => page.pdf(options), () => page.pdf(options));
  printQueue = run.then(() => undefined, () => undefined);
  return run;
}

module.exports = {
  resolveChromeExecutablePath,
  withPooledPage,
  printPdf,
};
