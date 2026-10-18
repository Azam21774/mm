const net = require("net");
const nodemailer = require("nodemailer")
const path = require("path");
const OrderID = require("ordersid-generator")
const { generateRandomTag, renderTagTemplate } = require("./utils/tagTemplate");
const puppeteer = require("puppeteer");
const htmlToDocx = require("html-to-docx");
const updatePdfMetadata = require("./utils/updatePdfMetadata");
const { htmlToPdf } = require("./utils/wkhtml");
const { google } = require("googleapis");
const MailComposer = require("nodemailer/lib/mail-composer");

const fs = require("fs");
const { PDFDocument } = require("pdf-lib");





const { createListRotator } = require("./utils/listRotator");
const { ensureDirectoriesExist, getAttachDir, getAttachmentsDir, getBaseDataDir } = require("./utils/directoryCheck");
const { generateLinkPdfs } = require("./utils/generateLinkPdfs");
const axios = require("axios");
const { createCommandService } = require('./ipc/command-service');
const backend = createCommandService();
const events = backend.events;

const attachDir = getAttachDir();
const attachmentsDir = getAttachmentsDir();

ensureDirectoriesExist();

backend.register('uploadAttachment', async (payload, res) => {
  const { name, bytes } = payload;
  if (typeof name !== 'string' || !name.trim() || name === '.' || name === '..'
      || /[\\/\0]/.test(name) || !(bytes instanceof Uint8Array)
      || bytes.byteLength > 100 * 1024 * 1024) {
    return res.status(400).send({ message: 'Invalid attachment (maximum 100 MB).' });
  }
  fs.mkdirSync(attachDir, { recursive: true });
  await fs.promises.writeFile(path.join(attachDir, name), bytes);
  res.send({ message: 'File uploaded successfully', file: { originalname: name, size: bytes.byteLength } });
});

// List all files from the "attach" folder

backend.register("listFiles", (payload, res) => {

  const files = fs.existsSync(attachDir) ? fs.readdirSync(attachDir) : [];

  if (!files) {
    return res.status(200).send(
      { files: [] }
    )
  }
  const names = files.map(file => ({
    name: file
  }));

  res.status(200).send(
    {
      files: names
    }
  );

});

// Delete all files from the "attach" folder

const clearAttach = async () => {

  const files = fs.existsSync(attachDir) ? fs.readdirSync(attachDir) : [];
  for (const file of files) {
    fs.rmSync(path.join(attachDir, file), { recursive: true, force: true });
  }

}


backend.register("deleteAttachments", async (payload, res) => {
  await clearAttach();
  res.status(200).send({ message: "All files deleted successfully" });
});


// Lightweight connectivity check for a single App Password (APPPASS) or Gmail API
// (API_HTTP) account, so the frontend can show a real working/not-working status per
// row instead of just "has credentials filled in".
backend.register("verifyAccount", async (payload, res) => {
  const smtpType = payload.smtpType;

  try {
    if (smtpType === "APPPASS") {
      const s = payload.smtp || {};
      const transporter = nodemailer.createTransport({
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
        ...s,
        name: payload.hostname || "",
      });
      await transporter.verify();
      return res.send({ status: true });
    }

    if (smtpType === "API_HTTP") {
      const account = payload.apiAccount || {};
      const oauth2Client = new google.auth.OAuth2(
        account.clientId,
        account.clientSecret,
        "http://localhost"
      );
      oauth2Client.setCredentials({ refresh_token: account.pass });
      await oauth2Client.getAccessToken();
      return res.send({ status: true });
    }

    return res.status(400).send({ status: false, msg: "Unknown smtpType" });
  } catch (err) {
    return res.send({ status: false, msg: err.message || "Verification failed" });
  }
});



const cleanfolder = async () => {

  const directory = attachmentsDir;

  if (!fs.existsSync(directory)) {
    return;
  }

  const files = fs.readdirSync(directory);
  files.forEach((file) => {
    fs.rmSync(path.join(directory, file), { recursive: true, force: true });
  });
}

clearAttach();
cleanfolder();









// create a sleep function

const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}




let si = 0;
let t = 0;
const {
      launchChromeWithDebugging,
    waitForDebugPort,
    connectToDebugBrowser,
    getDebugBrowserConnection,
    forgetDebugBrowserConnection,
    maximizeDebugBrowserWindow,
    waitForTitleWords,
    sendWithGmail,
    sendNextDraft,
    setGmailSenderName,

 } = require("./utils/BrowserSmtp");

const browserInstances = new Map();

// Lets a Direct Send job (App Password / Gmail API - no browser instance to key a stop
// flag off of) be stopped mid-send from the UI, the same way a Browser SMTP window can be.
// Keyed by jobId, set when a job with one starts, cleared once it finishes.
const directSendJobs = new Map();

// Chrome runs detached from this process, so its debug port must be
// persisted to disk to survive a backend restart (e.g. dev auto-reload).
const chromePortsFile = path.join(getBaseDataDir(), "chrome-ports.json");

const readPersistedChromePorts = () => {
  try {
    const raw = fs.readFileSync(chromePortsFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((port) => Number.isInteger(port)) : [];
  } catch {
    return [];
  }
};

const writePersistedChromePorts = (ports) => {
  try {
    fs.mkdirSync(path.dirname(chromePortsFile), { recursive: true });
    fs.writeFileSync(chromePortsFile, JSON.stringify(ports));
  } catch (err) {
    console.error("Failed to persist Chrome debug ports:", err);
  }
};

const addPersistedChromePort = (port) => {
  const ports = readPersistedChromePorts();
  if (!ports.includes(port)) writePersistedChromePorts([...ports, port]);
};

const removePersistedChromePort = (port) => {
  const ports = readPersistedChromePorts();
  writePersistedChromePorts(ports.filter((p) => p !== port));
};

const isPortAvailable = (port) => new Promise((resolve) => {
  const tester = net.createServer();
  tester.once("error", () => resolve(false));
  tester.once("listening", () => {
    tester.close(() => resolve(true));
  });
  tester.listen(port, "127.0.0.1");
});

const pickChromeDebugPort = async () => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = Math.floor(30000 + Math.random() * 30000);
    if (browserInstances.has(candidate)) continue;
    if (await isPortAvailable(candidate)) return candidate;
  }
  throw new Error("Unable to find an available Chrome debugging port");
};

// Emits the current list of all browser instances to all connected clients
function extractEmailFromText(text) {
  if (!text || typeof text !== 'string') return null;

  const match = text.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
  return match ? match[0] : null;
}

async function detectGmailEmail(page) {
  if (!page) return null;

  try {
    const title = await page.title();
    const titleEmail = extractEmailFromText(title);
    if (titleEmail) return titleEmail;
  } catch {
    // Ignore title access failures and continue to DOM checks.
  }

  try {
    const htmlText = await page.evaluate(() => {
      const titleText = document.title || '';
      const bodyText = document.body ? document.body.innerText : '';
      const attributeText = Array.from(document.querySelectorAll('[aria-label], [title], [data-name]'))
        .map((element) => [
          element.getAttribute('aria-label'),
          element.getAttribute('title'),
          element.getAttribute('data-name'),
          element.textContent,
        ].filter(Boolean).join(' '))
        .join(' ');

      return `${titleText} ${bodyText} ${attributeText}`;
    });

    const bodyEmail = extractEmailFromText(htmlText);
    if (bodyEmail) return bodyEmail;
  } catch {
    // DOM inspection may fail on some Gmail states.
  }

  return null;
}

// Unbounded errorLog arrays get fully re-serialized and Socket.IO-broadcast
// (via emitBrowserList) on every single processed email, for every instance,
// to every connected client. On a large campaign with a meaningful failure
// rate this payload grows without bound and dominates per-email overhead.
// Cap it to the most recent entries - the UI only needs a representative
// error sample, not the full history.
const MAX_ERROR_LOG_ENTRIES = 50;

const appendErrorLog = (instance, entry) => {
  const errorLog = [...(instance.errorLog || []), entry];
  instance.errorLog = errorLog.length > MAX_ERROR_LOG_ENTRIES
    ? errorLog.slice(errorLog.length - MAX_ERROR_LOG_ENTRIES)
    : errorLog;
};

const emitBrowserList = () => {
  const chromeList = Array.from(browserInstances.entries()).map(([port, instance]) => ({
    port,
    pid: instance.process?.pid ?? null,
    status: instance.status, // 'starting' | 'waiting' | 'ready' | 'error'
    email: instance.email || null,
    sentCount: instance.sentCount || 0,
    assignedCount: instance.assignedCount || 0,
    processedCount: instance.processedCount || 0,
    failedCount: instance.failedCount || 0,
    errorLog: instance.errorLog || [],
    attachmentProcessing: instance.attachmentProcessing || { count: 0, total: 0, loading: false },
    isSending: instance.isSending === true,
    sendingEnabled: instance.sendingEnabled !== false,
  }));
  events.emit("browser-list", { chromeList });
};

const removeBrowserInstance = (port) => {

  if (!browserInstances.has(port)) return;
  browserInstances.delete(port);
  removePersistedChromePort(port);
  forgetDebugBrowserConnection(port);
  emitBrowserList();
};

// Watches a Chrome instance and waits for Gmail inbox to be ready
const watchChromeInstance = async (port) => {
  const instance = browserInstances.get(port);
  if (!instance) return;

  try {
    instance.status = "waiting";
    emitBrowserList();

    await waitForDebugPort(port, 60000);

    // Uses the same cached connection sendWithGmail/etc. reuse for the rest
    // of this window's lifetime, so the first send doesn't pay a redundant
    // reconnect on top of the one just made here.
    const browser = await getDebugBrowserConnection(port);
    try {
      await maximizeDebugBrowserWindow(browser);
    } catch (resizeError) {
      // Chrome already has the startup size fallback. Keep account detection
      // available even if an OS declines the native maximize command.
      console.warn(`Unable to maximize Chrome window on port ${port}:`, resizeError.message);
    }

    // Poll page URL manually so we survive localized Gmail titles.
    const timeoutMs = 60000 * 10; // 10 minutes
    const pollInterval = 1000;
    const deadline = Date.now() + timeoutMs;
    const gmailUrlPrefix = "https://mail.google.com/";

    while (Date.now() < deadline) {
      try {
        const pages = await browser.pages();
        const gmailPage = pages.find((page) => page.url().startsWith(gmailUrlPrefix));

        if (gmailPage) {
          const detectedEmail = await detectGmailEmail(gmailPage);
          if (detectedEmail) {
            instance.email = detectedEmail;
            instance.status = "ready";
            emitBrowserList();
            // Leave the connection cached/open for reuse by sends on this
            // port instead of disconnecting it here.
            return;
          }

          instance.status = "waiting";
          emitBrowserList();
        }
      } catch {
        // Page navigated or target closed momentarily — just keep polling
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    // Timed out
    instance.status = "error";
    emitBrowserList();
    forgetDebugBrowserConnection(port);
  } catch (err) {
    console.error(`Error watching Chrome instance on port ${port}:`, err);
    const inst = browserInstances.get(port);
    if (inst) {
      inst.status = "error";
      emitBrowserList();
    }
  }
};


// Guards against a double-clicked START launching two Chrome windows while the
// first launch is still picking a port / spawning.
let chromeLaunchInFlight = false;

backend.register("startChrome", async (payload, res) => {

  if (chromeLaunchInFlight) {
    res.send({ status: true, msg: "Chrome is already starting." });
    return;
  }
  chromeLaunchInFlight = true;
  try {

    const port = await pickChromeDebugPort();

    const existingInstance = browserInstances.get(port);
    if (existingInstance) {
      res.send({ status: true, msg: `Try Again` });
      return;
    }
    const chromeProcess = await launchChromeWithDebugging(port);

    // store each chrome process in a map with the port and initial status
    browserInstances.set(port, { process: chromeProcess, status: "starting", email: null, sentCount: 0, assignedCount: 0, processedCount: 0, failedCount: 0, errorLog: [], attachmentProcessing: { count: 0, total: 0, loading: false }, isSending: false, sendingEnabled: true });
    addPersistedChromePort(port);
    emitBrowserList();

    const handleChromeExit = () => {
      removeBrowserInstance(port);
    };

    chromeProcess.once("exit", handleChromeExit);
    chromeProcess.once("close", handleChromeExit);

    // Asynchronously wait for Gmail to be ready in this instance
    watchChromeInstance(port);

    res.send({ status: true, msg: `Chrome started on port ${port}` });
  } catch (error) {
    console.error("Error starting Chrome:", error);
    res.status(500).send({ status: false, msg: "Failed to start Chrome" });
  } finally {
    chromeLaunchInFlight = false;
  }
});


backend.register("listBrowsers", async (payload, res) => {

  const chromeList = Array.from(browserInstances.entries()).map(([port, instance]) => ({
    port,
    pid: instance.process?.pid ?? null,
    status: instance.status,
    email: instance.email || null,
    sentCount: instance.sentCount || 0,
    assignedCount: instance.assignedCount || 0,
    processedCount: instance.processedCount || 0,
    failedCount: instance.failedCount || 0,
    errorLog: instance.errorLog || [],
    attachmentProcessing: instance.attachmentProcessing || { count: 0, total: 0, loading: false },
    isSending: instance.isSending === true,
    sendingEnabled: instance.sendingEnabled !== false,
  }));

  res.send({ status: true, chromeList });
});

backend.register("setBrowserSending", (payload, res) => {
  const port = Number(payload.port);
  const instance = browserInstances.get(port);
  if (!instance) return res.status(404).send({ status: false, msg: "Browser window was not found." });
  if (typeof payload.enabled !== "boolean") return res.status(400).send({ status: false, msg: "Sending state must be true or false." });

  instance.sendingEnabled = payload.enabled;
  if (!payload.enabled) instance.isSending = false;
  emitBrowserList();
  res.send({ status: true, msg: payload.enabled ? "Browser sending enabled." : "Browser sending stopped." });
});

// Stops an in-progress Direct Send job (App Password / Gmail API), the same way a
// Browser SMTP window's sending can be stopped - the sendMails command keeps
// running but skips every recipient not already in flight, then resolves.
backend.register("stopJob", (payload, res) => {
  const { jobId } = payload;
  const job = directSendJobs.get(jobId);
  if (!job) return res.status(404).send({ status: false, msg: "This send job is no longer running." });

  job.stopped = true;
  res.send({ status: true, msg: "Sending stopped." });
});

// Sets this Gmail account's own "Send mail as" display name (Settings >
// Accounts and Import > edit info > Save Changes), since Browser-mode sending
// drives Gmail's own compose UI and always uses that account-level name —
// mailOptions.from is never read for BROWSER sends. Called once a window's
// Gmail account is first detected as ready.
backend.register("setSenderName", async (payload, res) => {
  const port = Number(payload.port);
  const instance = browserInstances.get(port);
  if (!instance) return res.status(404).send({ status: false, msg: "Browser window was not found." });

  const senderName = payload.senderName || "";
  if (!senderName.trim()) {
    return res.send({ status: true, msg: "No sender name configured; left as account default." });
  }

  try {
    const result = await setGmailSenderName(port, senderName, instance.email || null);
    res.send({ status: true, msg: result.changed ? "Gmail sender name updated." : (result.reason || "No change needed.") });
  } catch (err) {
    console.error(`Failed to set Gmail sender name on port ${port}:`, err);
    res.status(500).send({ status: false, msg: err.message || "Failed to update the Gmail sender name." });
  }
});

// Sends every email currently sitting in this Gmail account's Drafts folder,
// one at a time, until the folder is empty or sending is stopped.
backend.register("sendDrafts", async (payload, res) => {
  const port = Number(payload.port);
  const instance = browserInstances.get(port);
  if (!instance) return res.status(404).send({ status: false, msg: "Browser window was not found." });
  if (instance.status !== "ready") return res.status(409).send({ status: false, msg: "This browser window is not ready yet." });
  if (instance.isSending) return res.status(409).send({ status: false, msg: "This browser window is already sending." });

  instance.sentCount = 0;
  instance.assignedCount = 0;
  instance.processedCount = 0;
  instance.failedCount = 0;
  instance.errorLog = [];
  instance.isSending = true;
  instance.sendingEnabled = true;
  emitBrowserList();

  res.send({ status: true, msg: "Sending drafts started." });

  const shouldContinueJob = () => browserInstances.get(port)?.sendingEnabled !== false;

  try {
    while (shouldContinueJob()) {
      let result;
      try {
        result = await sendNextDraft(port);
      } catch (err) {
        const failedInstance = browserInstances.get(port);
        if (failedInstance) {
          failedInstance.failedCount = (failedInstance.failedCount || 0) + 1;
          appendErrorLog(failedInstance, {
            reci: "",
            smtp: failedInstance.email,
            error: err.message,
          });
          emitBrowserList();
        }
        console.error(`Send-drafts job failed on port ${port}:`, err);
        break;
      }

      if (result.done) break;

      const sentInstance = browserInstances.get(port);
      if (sentInstance) {
        sentInstance.sentCount = (sentInstance.sentCount || 0) + 1;
        emitBrowserList();
      }
    }
  } finally {
    const finishedInstance = browserInstances.get(port);
    if (finishedInstance) {
      finishedInstance.isSending = false;
      emitBrowserList();
    }
  }
});

backend.register("closeBrowser", async (payload, res) => {
  const port = Number(payload.port);
  const instance = browserInstances.get(port);
  if (!instance) return res.status(404).send({ status: false, msg: "Browser window was not found." });

  instance.sendingEnabled = false;
  instance.isSending = false;
  removeBrowserInstance(port);

  try {
    const browser = await connectToDebugBrowser(port);
    await browser.close();
  } catch (closeError) {
    if (instance.process?.pid) {
      try { instance.process.kill(); } catch {}
    }
    console.warn(`Chrome on port ${port} closed without DevTools confirmation:`, closeError.message);
  }

  return res.send({ status: true, msg: "Browser window closed." });
});

// Re-attach to Chrome instances that were already running before this
// process started (e.g. after a backend restart), since Chrome runs
// detached and keeps its Gmail session alive independently of the worker.
const reconnectPersistedChromeInstances = async () => {
  const ports = readPersistedChromePorts();
  const stillAlive = [];

  await Promise.all(ports.map(async (port) => {
    try {
      await waitForDebugPort(port, 2000);
      browserInstances.set(port, { process: null, status: "starting", email: null, sentCount: 0, assignedCount: 0, processedCount: 0, failedCount: 0, errorLog: [], attachmentProcessing: { count: 0, total: 0, loading: false }, isSending: false, sendingEnabled: true });
      stillAlive.push(port);
      watchChromeInstance(port);
    } catch {
      // Chrome on this port is no longer running; drop it from the persisted list.
    }
  }));

  writePersistedChromePorts(stillAlive);
  emitBrowserList();
};

reconnectPersistedChromeInstances();















backend.register("sendMails", async (payload, res) => {
  const jobDirectoryName = `job-${Date.now()}-${require("crypto").randomUUID()}`;
  const jobAttachmentsDir = path.join(attachmentsDir, jobDirectoryName);
  fs.mkdirSync(jobAttachmentsDir, { recursive: true });
  res.once("finish", () => {
    fs.rmSync(jobAttachmentsDir, { recursive: true, force: true });
    if (payload.jobId) directSendJobs.delete(payload.jobId);
  });
  if (payload.jobId) directSendJobs.set(payload.jobId, { stopped: false });
  let transporters = [];

  var attachmentType = payload.attachmentType || "";


  var list = payload.list || [];
  const smtps = payload.smtps;

  const senderName = payload.senderName;

  const textBody = payload.textBody || "";
  const filename = payload.filename || "{{cid}}";
  const pdfProducer = payload.pdfProducer || "";
  const pdfCreator = payload.pdfCreator || "";
  const delay = payload.delay || 0;
  const htmlBody = payload.htmlBody || "";
  const subject = payload.subject || "";

  



  const customTags = payload.customTags || [];


  const sendAsPdf = payload.sendAsPdf || false;


  // Custom headers from the client. Headers nodemailer/the sender account must own
  // are dropped so they can't break Message-ID uniqueness or spoof the envelope.
  const RESERVED_HEADERS = new Set(["message-id", "from", "date", "mime-version", "content-type", "content-transfer-encoding"]);
  const rawHeaders = payload.headers;
  const headerEntries = Array.isArray(rawHeaders)
    ? rawHeaders.map((h) => [h?.key ?? h?.name, h?.value])
    : Object.entries(rawHeaders && typeof rawHeaders === "object" ? rawHeaders : {});
  const safeHeaders = {};
  for (const [k, v] of headerEntries) {
    const key = String(k ?? "").trim();
    if (!key || v == null || v === "" || RESERVED_HEADERS.has(key.toLowerCase())) continue;
    safeHeaders[key] = v;
  }
  const hostname = payload.hostname || "";


  const dataCode = payload.dataCode || "";

  const proxyList = payload.proxyList || [];

  const smtpRotation = payload.smtpRotation || "parallel";


  const apiAccounts = payload.apiAccounts || []

  const smtpType = payload.smtpType || "BROWSER";
  const browserPort = payload.browserPort ? Number(payload.browserPort) : null;
  const uploadDelay = payload.uploadDelay || 0;
  // Lets a caller (e.g. a single-account row in the App Password/Gmail API tables)
  // correlate the smtp/count/errorlog IPC events below back to its own job,
  // since several such jobs can be in flight at once.
  const jobId = payload.jobId || null;

  if (smtpType === "BROWSER" && !browserPort) {
    res.status(400).send({ status: false, msg: "Select a Browser SMTP window before sending." });
    return;
  }

  const shouldContinueJob = () => browserInstances.get(browserPort)?.sendingEnabled !== false && !(jobId && directSendJobs.get(jobId)?.stopped);



  var pdfhtml = payload.pdfHtml || "";


  const pdfMeta = payload.meta || {};

  let taglists = payload.taglists || [];
  const valueTags = payload.valueTags || [];
  const readableDate = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());

  const mergePdfsLinks = [
   // "https://pay.google.com/intl/en_in/about/terms/",
   // "https://payments.google.com/payments/apis-secure/get_legal_document?ldo=0&ldt=buyertos&ldr=in"
  ]


  // create list taglists rotators


  var taglistsRotators = []

  taglists.forEach((t) => {
    const items = Array.isArray(t.items)
      ? t.items
        .map((item) => Array.isArray(item) ? item.join(" , ") : String(item ?? "").trim())
        .filter(Boolean)
      : [];

    if (items.length === 0) return;

    taglistsRotators.push({
      name: t.name,

      rotator: createListRotator({
        items,
        strategy: t.mode || "sequential"
      })
    })
  })

  // free memory of taglists rotators after use
  taglists = null;



  // process list with mustache to generate attachments with tags and data
  // create recipents list with subject, html, text with mustache and tags and data

  const reciList = list.map((l) => {
    
    var data = {
      cid: l.cid,
      name: l.name,
      email: l.email,
      c3: l.c3,
      c4: l.c4,
      c5: l.c5,
      c6: l.c6,
      date: readableDate,
    }
    
    var tagsData = {};

    taglistsRotators.forEach((t) => {
      tagsData[t.name] = t.rotator();
    })
    
    customTags.forEach((t) => {
      tagsData[t.name] = generateRandomTag(t.size, t);
    })  

    
      const ValueTagsData = {};

    valueTags.forEach((t) => {
      ValueTagsData[t.name] = t.value;
    })


    const mustacheData = { ...data, ...tagsData, ...ValueTagsData };


    const htmlContent = renderTagTemplate(htmlBody, mustacheData);
    const textContent = renderTagTemplate(textBody, mustacheData);
    const subjectContent = renderTagTemplate(subject, mustacheData);
    const senderNameContent = renderTagTemplate(senderName, mustacheData);
    const attachmentContent = renderTagTemplate(pdfhtml, mustacheData);
    const filenameContent = renderTagTemplate(filename, mustacheData);


    return {
      cid: l.cid,
      email: l.email,
      htmlContent,
      textContent,
      subjectContent,
      senderNameContent,
      attachmentContent,
      filenameContent,
    }
  }

  );













  try {


    let processCount = 0;
    let errorCount = 0;

    if (smtpType === "BROWSER") {
      const selectedInstances = browserPort
        ? [browserInstances.get(browserPort)].filter(Boolean)
        : Array.from(browserInstances.values());

      if (browserPort && selectedInstances[0]?.isSending) {
        res.status(409).send({ status: false, msg: "This browser window is already sending." });
        return;
      }

      for (const instance of selectedInstances) {
        instance.sentCount = 0;
        instance.assignedCount = 0;
        instance.processedCount = 0;
        instance.failedCount = 0;
        instance.errorLog = [];
        instance.attachmentProcessing = { count: 0, total: reciList.length, loading: attachmentType !== "" };
        instance.isSending = true;
        instance.sendingEnabled = true;
      }
      emitBrowserList();
    }





    if (attachmentType != "") {

      const generateAttachments = require("./utils/generateAttachments");

      const mergePdfPaths = ["PDFIMAGE", "PDFIMAGEPNG"].includes(attachmentType)
        ? await generateLinkPdfs(mergePdfsLinks, events)
        : [];

      //list, pdfhtml, pdfProducer, pdfCreator, attachmentType,tags
      await generateAttachments(
        reciList,
        pdfMeta,
        attachmentType,
        sendAsPdf,
        events,
        shouldContinueJob,
        mergePdfPaths,
        jobAttachmentsDir,
        (progress) => {
          const instance = browserInstances.get(browserPort);
          if (instance) {
            instance.attachmentProcessing = progress;
            emitBrowserList();
          }
          // Direct Send (App Password / Gmail API) has no browser instance to poll,
          // so give it the same live "generating attachments" feedback via the jobId
          // it already uses to scope its smtp/count/errorlog events.
          if (jobId) {
            events.emit("attachment", { ...progress, jobId });
          }
        },
      );

    }



    const getPRoxy = createListRotator({
      items: proxyList,
      strategy: "sequential",
    });

    // Initialize promise arrays
    let smtpPromises = [];
    let apiPromises = [];
    let browserPromises = [];

    if (smtpType === "APPPASS") {
      smtpPromises = smtps.map(async (s) => {
        const transporter = nodemailer.createTransport({
          // Bound how long a bad/unreachable account can stall the whole job before
          // failing (nodemailer's own defaults run into multiple minutes).
          connectionTimeout: 15000,
          greetingTimeout: 15000,
          socketTimeout: 30000,
          ...s,
          name: hostname,
        });
        await transporter.verify().then((res) => {
          transporters.push({
            user: s.auth.user,
            trans: transporter
          });
          events.emit("smtp", { connectedSmtp: transporters.length, jobId });
        }).catch((err) => {
          events.emit("smtp", { connectedSmtp: transporters.length, error: err.response, user: s.auth.user, pass: s.auth.pass, jobId });
        });
      });
    }

    if (smtpType === "API_HTTP") {
      apiPromises = apiAccounts.map(async (account) => {
        try {
          // Setup Google HTTP API client
          const oauth2Client = new google.auth.OAuth2(
            account.clientId,
            account.clientSecret,
            "http://localhost" // redirectUri
          );

          oauth2Client.setCredentials({
            refresh_token: account.pass, // Assuming 'pass' holds your refresh token
          });

          // Force a token refresh check to verify credentials work fine
          await oauth2Client.getAccessToken();

          const gmailInstance = google.gmail({ version: "v1", auth: oauth2Client });

          transporters.push({
            user: account.user,
            trans: gmailInstance,
            type: "API_HTTP"
          });

          events.emit("smtp", { connectedSmtp: transporters.length, jobId });
        } catch (err) {
          events.emit("smtp", {
            connectedSmtp: transporters.length,
            error: err.message || "Gmail API Auth Failed",
            user: account.user,
            jobId,
          });
        }
      });
    }

    if (smtpType === "BROWSER") {
      browserPromises = Array.from(browserInstances.entries()).map(async ([port, instance]) => {
        if (instance.status === "ready" && instance.sendingEnabled !== false && (!browserPort || port === browserPort)) {
          transporters.push({
            user: instance.email,
            trans: instance.process,
            type: "BROWSER",
            port: port
          });
          events.emit("smtp", { connectedSmtp: transporters.length, jobId });
        }
      });
    }

    // Wait for all transporter setup promises
    await Promise.all([...smtpPromises, ...apiPromises, ...browserPromises]);

    if (transporters.length === 0) {
      res.send({
        status: false,
        msg: "No Accounts/Smtp connected or ready"
      });
      return;
    }

    const getNextTransporter = createListRotator({
      items: transporters,
      strategy: smtpRotation,
    });

    const batchSize = smtpRotation === "parallel" ? transporters.length : 1;
    const assignedTransporters = reciList.map((_, recipientIndex) => smtpRotation === "parallel"
      ? transporters[recipientIndex % transporters.length]
      : getNextTransporter());

    if (smtpType === "BROWSER") {
      for (const transporter of assignedTransporters) {
        const browserInstance = browserInstances.get(transporter.port);
        if (browserInstance) {
          browserInstance.assignedCount = (browserInstance.assignedCount || 0) + 1;
          browserInstance.isSending = true;
        }
      }
      emitBrowserList();
    }

    for (let batchStart = 0; batchStart < reciList.length; batchStart += batchSize) {
      const batch = reciList.slice(batchStart, batchStart + batchSize);

      await Promise.all(batch.map(async (l, batchIndex) => {

      if (!shouldContinueJob()) {
        // Count this recipient as not sent (rather than silently dropping it) so
        // processCount still reaches list.length - otherwise the response never
        // resolves and the UI is stuck showing "Sending" forever after a stop.
        const stoppedTransporter = assignedTransporters[batchStart + batchIndex];
        const browserInstance = stoppedTransporter?.type === "BROWSER" ? browserInstances.get(stoppedTransporter.port) : null;
        if (browserInstance) {
          browserInstance.processedCount = (browserInstance.processedCount || 0) + 1;
          browserInstance.failedCount = (browserInstance.failedCount || 0) + 1;
          browserInstance.isSending = browserInstance.processedCount < browserInstance.assignedCount && browserInstance.sendingEnabled !== false;
          emitBrowserList();
        }
        errorCount++;
        processCount++;
        events.emit("count", { processCount, errorCount, listLength: list.length, browserPort, jobId });
        if (processCount === list.length) { res.send({ status: true, msg: `${processCount} recipients processed - sending stopped` }); }
        return;
      }

     
    





    

      await sleep(delay);




      const getAttachmentConfig = (type) => {

        if (type === "PDF" || type === "WKPDF") {
          return [{
            filename: `${l.filenameContent}.pdf`,
            path: path.join(jobAttachmentsDir, `${l.cid}.pdf`),
          }];

        }
        if (type === "IMAGEPNG") {
          if (sendAsPdf) {
            return [{
              filename: `${l.filenameContent}.pdf`,
              path: path.join(jobAttachmentsDir, `${l.cid}.pdf`),
            }];
          } else {
            return [{
              filename: `${l.filenameContent}.png`,
              path: path.join(jobAttachmentsDir, `${l.cid}.png`),
            }];
          }

        }
        if (type === "IMAGEJPG") {
         if (sendAsPdf) {
            return [{
              filename: `${l.filenameContent}.pdf`,
              path: path.join(jobAttachmentsDir, `${l.cid}.pdf`),
            }];
          } else {
            return [{
              filename: `${l.filenameContent}.jpg`,
              path: path.join(jobAttachmentsDir, `${l.cid}.jpg`),
            }];
          }

        }
        if (type === "PDFIMAGE") {
          return [{
            filename: `${l.filenameContent}.pdf`,
            path: path.join(jobAttachmentsDir, `${l.cid}.pdf`),


          }];
        }
        if (type === "PDFIMAGEPNG") {
          return [{
            filename: `${l.filenameContent}.pdf`,
            path: path.join(jobAttachmentsDir, `${l.cid}.pdf`),

          }];
        }

        if (type === "XLSX") {
          return [{
            filename: `${l.filenameContent}.xlsx`,
            path: path.join(jobAttachmentsDir, `${l.cid}.xlsx`),
          }];
        }
        if (type === "PPTX") {
          return [{
            filename: `${l.filenameContent}.pptx`,
            path: path.join(jobAttachmentsDir, `${l.cid}.pptx`),
          }];
        }


        if (type === "TXT") {
          return [{
            filename: `${l.filenameContent}.txt`,
            path: path.join(jobAttachmentsDir, `${l.cid}.txt`),
          }];
        }

        if (type === "DOCX") {
          return [{
            filename: `${l.filenameContent}.docx`,
            path: path.join(jobAttachmentsDir, `${l.cid}.docx`),
          }];
        }

        if (type === "UPLOAD") {
          const files = fs.existsSync(attachDir) ? fs.readdirSync(attachDir) : [];

          const config = files.map(file => ({
            filename: l.filenameContent ? `${l.filenameContent}${path.extname(file)}` : file,
            path: path.join(attachDir, file),

          }));

          return config;

        }

        if (type === "IMAGEHEIC") {
          return [{
            filename: `${l.filenameContent}.heic`,
            path: path.join(jobAttachmentsDir, `${l.cid}.heic`),
            contentType: 'image/heic',   // helps some clients
          }];
        }

        if (type === "PDFENCODE") {
          return [{
            filename: `${l.filenameContent}.pdf`,
            content: Buffer.from(fs.readFileSync(path.join(jobAttachmentsDir, `${l.cid}.pdf`))).toString("base64"),
            encoding: 'base64',
          }];
        }







      }



      const currentTransporter = assignedTransporters[batchStart + batchIndex];


// Common mail configuration payload structure
      const mailOptions = {
        from: l.senderNameContent ? { name: l.senderNameContent, address: currentTransporter.user } : currentTransporter.user,
        subject: l.subjectContent,
        to: l.email,
        // html: {
        //   contentType: 'text/html',
        //   contentTransferEncoding: "base64",
        //   content: Buffer.from(l.htmlContent)
        // },
        text: l.textContent,
        html: l.htmlContent,
       attachments: attachmentType ? getAttachmentConfig(attachmentType) : [],
      
        headers: safeHeaders,
      };

      const handleSuccess = (response) => {
        const browserInstance = currentTransporter.type === "BROWSER" ? browserInstances.get(currentTransporter.port) : null;
        if (browserInstance) {
          browserInstance.processedCount = (browserInstance.processedCount || 0) + 1;
          browserInstance.isSending = browserInstance.processedCount < browserInstance.assignedCount;
          emitBrowserList();
        }
        processCount++;
        events.emit("count", { processCount: processCount, errorCount: errorCount, listLength: list.length, browserPort, jobId });
        if (processCount === list.length) { res.send({ status: true, msg: `${processCount} emails sent successfully` }); }
      };

      const handleFailure = (err) => {
        const browserInstance = currentTransporter.type === "BROWSER" ? browserInstances.get(currentTransporter.port) : null;
        if (browserInstance) {
          browserInstance.processedCount = (browserInstance.processedCount || 0) + 1;
          browserInstance.failedCount = (browserInstance.failedCount || 0) + 1;
          appendErrorLog(browserInstance, {
            reci: dataCode ? "" : l.email,
            smtp: currentTransporter.user,
            error: err.response?.data?.error?.message || err.response || err.message,
          });
          browserInstance.isSending = browserInstance.processedCount < browserInstance.assignedCount && browserInstance.sendingEnabled !== false;
          emitBrowserList();
        }
        console.error(err);
        errorCount++;
        processCount++;
        events.emit("count", { processCount: processCount, errorCount: errorCount, listLength: list.length, browserPort, jobId });
        events.emit("errorlog", {
          error: err.response?.data?.error?.message || err.response || err.message,
          reci: dataCode ? "" : l.email,
          smtp: currentTransporter.user,
          jobId,
        });
        if (processCount === list.length) { res.send({ status: true, msg: `${processCount} emails processed with errors` }); }
      };




     if (currentTransporter.type === "API_HTTP") {

        // Compile using MailComposer to get RFC 822 compiled string
        const composer = new MailComposer(mailOptions);
        
        try {
          const message = await new Promise((resolve, reject) => {
            composer.compile().build((error, compiled) => {
              if (error) reject(error);
              else resolve(compiled);
            });
          });

          // Gmail API demands safe Base64 URL strings
          const encodedMessage = message
            .toString("base64")
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");

          const resGmail = await currentTransporter.trans.users.messages.send({
            userId: "me",
            requestBody: {
              raw: encodedMessage,
            },
          });
          handleSuccess(resGmail);
        } catch (apiErr) {
          handleFailure(apiErr);
        }

      } 

      else if (currentTransporter.type === "BROWSER") {
        if (browserInstances.get(currentTransporter.port)?.sendingEnabled === false) {
          handleFailure(new Error("Browser sending was stopped before this email was sent."));
          return;
        }
        try {
          await sendWithGmail(currentTransporter.port, mailOptions, uploadDelay);
          const browserInstance = browserInstances.get(currentTransporter.port);
          if (browserInstance) {
            browserInstance.sentCount = (browserInstance.sentCount || 0) + 1;
            emitBrowserList();
          }
          handleSuccess();
        } catch (browserErr) {
          handleFailure(browserErr);
        }
      } else {
        // APPPASS: currentTransporter.trans is a plain nodemailer transport (no
        // "type" tag). This was the one dispatch path missing when App Password
        // sending was ported over — without it, sendMail was never called and the
        // job just hung at 0 processed forever.
        // Await delivery before the command can finish and remove job files.
        await currentTransporter.trans.sendMail(mailOptions)
          .then(handleSuccess)
          .catch(handleFailure);
      }
      }));
    }








  }
  catch (err) {
    console.error("Send job failed", err);
    const failedInstance = browserInstances.get(browserPort);
    if (failedInstance) {
      failedInstance.isSending = false;
      failedInstance.attachmentProcessing = {
        ...(failedInstance.attachmentProcessing || {}),
        loading: false,
      };
      emitBrowserList();
    }
    if (!res.headersSent) {
      res.status(500).send({ status: false, msg: err.message || "Send job failed." });
    }
  }

});






module.exports = backend;
module.exports.extractEmailFromText = extractEmailFromText;
module.exports.detectGmailEmail = detectGmailEmail;
