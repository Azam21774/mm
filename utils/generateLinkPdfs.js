const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { PDFDocument, PDFName } = require("pdf-lib");
const { attachmentsDir } = require("./dataPaths");

const LINK_PDF_DIR = path.join(__dirname, "..", "linkspfds");
const BLANK_PAGE_WIDTH = 595.28;
const BLANK_PAGE_HEIGHT = 841.89;

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

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function getLinkPdfName(url, index) {
  let hostname = "page";
  try {
    hostname = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, "_");
  } catch {
    // Keep a stable fallback for malformed URLs so the caller gets a useful error from page.goto.
  }

  return `${String(index + 1).padStart(2, "0")}-${hostname}.pdf`;
}

function removePageAnnotations(pdfDocument) {
  pdfDocument.getPages().forEach((pdfPage) => {
    pdfPage.node.delete(PDFName.of("Annots"));
  });
}

async function generateLinkPdfs(links, io) {
  const urls = Array.isArray(links) ? links.filter((link) => typeof link === "string" && link.trim()) : [];
  if (urls.length === 0) return [];

  fs.mkdirSync(LINK_PDF_DIR, { recursive: true });
  const chromeExecutablePath = resolveChromeExecutablePath();
  const launchOptions = {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  };

  if (chromeExecutablePath) launchOptions.executablePath = chromeExecutablePath;
  if (process.platform === "win32" && !chromeExecutablePath) {
    throw new Error("Chrome not found for link PDF generation.");
  }

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  const generatedFiles = [];

  try {
    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index].trim();
      io?.emit("link-pdf", { count: index, total: urls.length, loading: true, url });

      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: 120000,
      });

      const webpagePdf = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
      });
      const webpageDocument = await PDFDocument.load(webpagePdf);
      removePageAnnotations(webpageDocument);
      const outputDocument = await PDFDocument.create();

      for (let blankPage = 0; blankPage < 3; blankPage += 1) {
        outputDocument.addPage([BLANK_PAGE_WIDTH, BLANK_PAGE_HEIGHT]);
      }

      const webpagePages = await outputDocument.copyPages(
        webpageDocument,
        webpageDocument.getPageIndices(),
      );
      webpagePages.forEach((webpagePage) => outputDocument.addPage(webpagePage));

      const outputPath = path.join(LINK_PDF_DIR, getLinkPdfName(url, index));
      fs.writeFileSync(outputPath, await outputDocument.save());
      generatedFiles.push(outputPath);
      io?.emit("link-pdf", { count: index + 1, total: urls.length, loading: true, url, path: outputPath });
    }
  } finally {
    await browser.close();
    io?.emit("link-pdf", { count: generatedFiles.length, total: urls.length, loading: false });
  }

  return generatedFiles;
}

module.exports = {
  LINK_PDF_DIR,
  generateLinkPdfs,
};
