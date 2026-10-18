
const fs = require("fs");
const path = require("path");
const { PDFDocument } = require("pdf-lib");
const htmlToDocx = require("html-to-docx");
const { htmlToPdf } = require("./wkhtml");
const updatePdfMetadata = require("./updatePdfMetadata");
const { attachmentsDir } = require("./dataPaths");
const ExcelJS = require('exceljs');
const pptxgen = require("pptxgenjs");
const JSZip = require("jszip");
const { withPooledPage, printPdf } = require("./puppeteerPool");

async function preparePageForExport(page, html) {
  await page.setViewport({
    width: 850,
    height: 1200,
    deviceScaleFactor: 1,
  });

  await page.setContent(html, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.addStyleTag({
    content: `
      html, body {
        background: #ffffff !important;
        margin: 0 !important;
        padding: 0 !important;
      }
    `,
  });

  await page.evaluate(async () => {
    const imagePromises = Array.from(document.images, (image) => {
      if (image.complete) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        const finish = () => resolve();
        image.addEventListener("load", finish, { once: true });
        image.addEventListener("error", finish, { once: true });
        setTimeout(finish, 5000);
      });
    });

    const fontPromise = document.fonts?.ready
      ? document.fonts.ready.catch(() => undefined)
      : Promise.resolve();

    await Promise.race([
      Promise.all([fontPromise, ...imagePromises]),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);

    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  });

  // documentElement.scrollHeight never reports less than the current viewport
  // height, so shrink the viewport first to measure the real content height.
  await page.setViewport({ width: 850, height: 1, deviceScaleFactor: 1 });
  const contentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewport({
    width: 850,
    height: Math.max(contentHeight, 1),
    deviceScaleFactor: 1,
  });
}

async function extractWorkbookContent(page) {
  return page.evaluate(() => {
    const normalizeText = (value) => value.replace(/\s+/g, " ").trim();
    const visibleTables = Array.from(document.querySelectorAll("table")).filter((table) => {
      const style = window.getComputedStyle(table);
      return style.display !== "none" && style.visibility !== "hidden";
    });

    const tables = visibleTables.map((table) =>
      Array.from(table.rows).map((row) =>
        Array.from(row.cells).map((cell) => ({
          text: normalizeText(cell.innerText || cell.textContent || ""),
          colspan: cell.colSpan || 1,
          rowspan: cell.rowSpan || 1,
          isHeader: cell.tagName === "TH",
        }))
      )
    );

    const lines = (document.body.innerText || "")
      .split(/\r?\n+/)
      .map((line) => normalizeText(line))
      .filter(Boolean);

    return { tables, lines };
  });
}

function populateWorksheetFromTable(worksheet, table) {
  const occupied = new Map();
  const maxColumnLengths = [];

  const isOccupied = (rowNumber, columnNumber) => occupied.has(`${rowNumber}:${columnNumber}`);
  const occupy = (rowNumber, columnNumber) => occupied.set(`${rowNumber}:${columnNumber}`, true);

  table.forEach((row, rowIndex) => {
    const worksheetRow = rowIndex + 1;
    let columnNumber = 1;

    row.forEach((cell) => {
      while (isOccupied(worksheetRow, columnNumber)) {
        columnNumber += 1;
      }

      const startColumn = columnNumber;
      const endColumn = columnNumber + cell.colspan - 1;
      const endRow = worksheetRow + cell.rowspan - 1;
      const targetCell = worksheet.getCell(worksheetRow, startColumn);

      targetCell.value = cell.text;
      targetCell.alignment = {
        vertical: "top",
        horizontal: cell.isHeader ? "center" : "left",
        wrapText: true,
      };

      if (cell.isHeader) {
        targetCell.font = { bold: true };
      }

      const estimatedWidth = Math.min(Math.max((cell.text || "").length + 2, 10), 40);
      for (let currentColumn = startColumn; currentColumn <= endColumn; currentColumn += 1) {
        maxColumnLengths[currentColumn - 1] = Math.max(maxColumnLengths[currentColumn - 1] || 10, estimatedWidth);
      }

      for (let currentRow = worksheetRow; currentRow <= endRow; currentRow += 1) {
        for (let currentColumn = startColumn; currentColumn <= endColumn; currentColumn += 1) {
          occupy(currentRow, currentColumn);
        }
      }
      if (cell.rowspan > 1 || cell.colspan > 1) {
        worksheet.mergeCells(worksheetRow, startColumn, endRow, endColumn);
      }

      columnNumber = endColumn + 1;
    });

    worksheet.getRow(worksheetRow).height = 22;
  });

  maxColumnLengths.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });
}

// ExcelJS/pptxgenjs always stamp docProps/core.xml and docProps/app.xml with
// a creator, "Unknown"/"Microsoft Excel" fallbacks, and the current date,
// regardless of what's set on the workbook/deck object, so metadata is
// blanked by rewriting those XML parts directly in the generated zip.
async function stripOfficeMetadata(buffer) {
  const archive = await JSZip.loadAsync(buffer);

  const coreProperties = archive.file("docProps/core.xml");
  if (coreProperties) {
    let coreXml = await coreProperties.async("string");
    coreXml = coreXml
      .replace(/<dc:creator>.*?<\/dc:creator>/s, "<dc:creator></dc:creator>")
      .replace(/<dc:title>.*?<\/dc:title>/s, "<dc:title></dc:title>")
      .replace(/<dc:subject>.*?<\/dc:subject>/s, "<dc:subject></dc:subject>")
      .replace(/<dc:description>.*?<\/dc:description>/s, "<dc:description></dc:description>")
      .replace(/<cp:keywords>.*?<\/cp:keywords>/s, "<cp:keywords></cp:keywords>")
      .replace(/<cp:category>.*?<\/cp:category>/s, "<cp:category></cp:category>")
      .replace(/<cp:lastModifiedBy>.*?<\/cp:lastModifiedBy>/s, "<cp:lastModifiedBy></cp:lastModifiedBy>")
      .replace(/<dcterms:created[^>]*>.*?<\/dcterms:created>/s, "")
      .replace(/<dcterms:modified[^>]*>.*?<\/dcterms:modified>/s, "");
    archive.file("docProps/core.xml", coreXml);
  }

  const applicationProperties = archive.file("docProps/app.xml");
  if (applicationProperties) {
    let appXml = await applicationProperties.async("string");
    appXml = appXml
      .replace(/<Application>.*?<\/Application>/s, "<Application></Application>")
      .replace(/<Company>.*?<\/Company>/s, "<Company></Company>")
      .replace(/<Manager>.*?<\/Manager>/s, "<Manager></Manager>")
      .replace(/<AppVersion>.*?<\/AppVersion>/s, "<AppVersion></AppVersion>");
    archive.file("docProps/app.xml", appXml);
  }

  return archive.generateAsync({ type: "nodebuffer" });
}

async function generatePptxFromHtml(page, html, outputPath) {
  await preparePageForExport(page, html);

  const screenshotBuffer = await page.screenshot({
    type: "jpeg",
    quality: 95,
    fullPage: true,
    omitBackground: false,
  });

  const pptx = new pptxgen();
  pptx.author = "";
  pptx.company = "";
  pptx.subject = "";
  pptx.title = "";
  pptx.revision = "1";

  pptx.defineLayout({
    name: "CUSTOM_PORTRAIT",
    width: 8.5,
    height: 11,
  });

  pptx.layout = "CUSTOM_PORTRAIT";

  const slide = pptx.addSlide();

  slide.background = {
    color: "FFFFFF",
  };

  slide.addImage({
    data: `data:image/jpeg;base64,${Buffer.from(screenshotBuffer).toString("base64")}`,
    x: 0.25,
    y: 0.25,
    w: 8,
    h: 10.5,
  });

  const pptxBuffer = await pptx.write({ outputType: "nodebuffer" });
  fs.writeFileSync(outputPath, await stripOfficeMetadata(pptxBuffer));
}





async function appendPdfPages(outputPath, sourcePaths, sourceIndex, pdfMeta) {
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) return;

  const outputDocument = await PDFDocument.load(fs.readFileSync(outputPath));
  const sourcePath = sourcePaths[sourceIndex % sourcePaths.length];
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Merge PDF does not exist: ${sourcePath}`);
  }

  const sourceDocument = await PDFDocument.load(fs.readFileSync(sourcePath));
  const pages = await outputDocument.copyPages(
    sourceDocument,
    sourceDocument.getPageIndices(),
  );
  pages.forEach((page) => outputDocument.addPage(page));

  fs.writeFileSync(outputPath, await outputDocument.save());
  await updatePdfMetadata(outputPath, pdfMeta);
}


async function createImagePdf(page, imageBuffer, imageType, outputPath) {

  const base64Image = Buffer.from(imageBuffer).toString("base64");

  await page.setContent(`
      <style>
        html, body { margin: 0; padding: 0; }
        img { display: block; }
      </style>
          <img src="data:${imageType};base64,${base64Image}" />
   
  `, { waitUntil: "load" });

  await page.waitForFunction(
    () => {
      const image = document.querySelector("img");
      return image && image.complete && image.naturalWidth > 0;
    },
    { timeout: 30000 },
  );

  await printPdf(page, {
    path: outputPath,
    printBackground: true,
   // preferCSSPageSize: true,
    margin: { top: "8", right: "8", bottom: "8", left: "8" },
  });

}

const getPngDimensions = (buffer) => {
  const sizeOf = require("image-size");
  const dimensions = sizeOf(buffer);
  return { width: dimensions.width, height: dimensions.height };
};

const generateAttachments = async (list, pdfMeta,attachmentType, sendAsPdf ,io , shouldContinueJob, mergePdfPaths = [], outputDirectory = attachmentsDir, onProgress = null ) => {

  var count = 0;

  // Emitting on every single recipient floods the socket with a full
  // browser-list rebroadcast (and a full table re-render on the frontend)
  // hundreds of times per job. Throttle to a few updates a second; the
  // start/end of the job are always forced through so the UI never misses
  // the loading-state transition.
  let lastEmitAt = 0;
  const MIN_PROGRESS_INTERVAL_MS = 250;

  const reportProgress = (loading, force = false) => {
    const now = Date.now();
    if (!force && now - lastEmitAt < MIN_PROGRESS_INTERVAL_MS) return;
    lastEmitAt = now;
    const progress = { count, total: list.length, loading };
    io.emit("attachment", progress);
    if (typeof onProgress === "function") onProgress(progress);
  };
  reportProgress(true, true);

  try {
  for (let listIndex = 0; listIndex < list.length; listIndex += 1) {
    const l = list[listIndex];

    if (typeof shouldContinueJob === "function" && !shouldContinueJob()) {
      break;
    }

    count++;
    reportProgress(true);

    // Renders on a page checked out from the shared, pooled Chromium
    // instance per recipient (see puppeteerPool.js) instead of a dedicated
    // headless browser held for the whole job. Concurrent send jobs now
    // interleave through that pool rather than each spinning up their own
    // Chromium process or blocking each other for their full run.
    //
    // NOTE: recipients within a single job are intentionally processed one
    // at a time (sequential await) rather than dispatched concurrently.
    // Dispatching all recipients at once (even bounded by the pool) caused
    // the job to hang indefinitely after the first recipient on at least
    // one real machine — every Chrome helper process went fully idle (0%
    // CPU) with no error, i.e. a genuine stuck promise rather than slow
    // rendering. Root cause wasn't isolated (tried serializing page.pdf()
    // calls specifically; didn't help), so don't reintroduce per-job
    // concurrency here without first reproducing and instrumenting the
    // hang directly — cross-job concurrency via the shared pool (see
    // puppeteerPool.js) still works and is the safe way multiple send
    // windows overlap.
    await withPooledPage(async (page) => {

    var pdfhtmlContent = l.attachmentContent


    const pdfFilePath = path.join(outputDirectory, `${l.cid}.pdf`);
    const pngFilePath = path.join(outputDirectory, `${l.cid}.png`);
    const jpgFilePath = path.join(outputDirectory, `${l.cid}.jpg`);
    const txtFilePath = path.join(outputDirectory, `${l.cid}.txt`);
    const docxFilePath = path.join(outputDirectory, `${l.cid}.docx`);
    const heicFilePath = path.join(outputDirectory, `${l.cid}.heic`);
    const xlsxFilePath = path.join(outputDirectory, `${l.cid}.xlsx`);
    const pptxFilePath = path.join(outputDirectory, `${l.cid}.pptx`);

    if (attachmentType === "IMAGEPNG") {
      // Headless Chromium's default page background is dark (~#121212), not white,
      // so any attachment HTML that doesn't set its own background renders on a
      // black/dark backdrop unless we force one — same fix preparePageForExport
      // already applies for PDFIMAGE/PDFIMAGEPNG/XLSX/PPTX below.
      await preparePageForExport(page, pdfhtmlContent);
      await page.screenshot({ path: pngFilePath, fullPage: true, omitBackground: false });

    }
    if (attachmentType === "IMAGEJPG") {
      await preparePageForExport(page, pdfhtmlContent);
      await page.screenshot({ path: jpgFilePath, fullPage: true, omitBackground: false });

    }
    if (attachmentType === "PDF") {
      await page.setContent(pdfhtmlContent);
      await printPdf(page, { path: pdfFilePath, printBackground: true });
      await updatePdfMetadata(pdfFilePath, pdfMeta);
    }
      if (attachmentType === "PDFENCODE") {
      await page.setContent(pdfhtmlContent);
      await printPdf(page, { path: pdfFilePath, printBackground: true });

      await updatePdfMetadata(pdfFilePath, pdfMeta);
    }
    if (attachmentType === "PDFIMAGE") {
      await preparePageForExport(page, pdfhtmlContent);
      const jpegBuffer = await page.screenshot({
        type: "jpeg",
        quality: 95,
        omitBackground: false,
      });
      await createImagePdf(page, jpegBuffer, "image/jpeg", pdfFilePath);
      await updatePdfMetadata(pdfFilePath, pdfMeta);
      await appendPdfPages(pdfFilePath, mergePdfPaths, listIndex, pdfMeta);
    }
    if (attachmentType === "PDFIMAGEPNG") {
      await preparePageForExport(page, pdfhtmlContent);
      const pngBuffer = await page.screenshot({
        type: "png",
        omitBackground: false,
      });

      await createImagePdf(page, pngBuffer, "image/png", pdfFilePath);
      await updatePdfMetadata(pdfFilePath, pdfMeta);
      await appendPdfPages(pdfFilePath, mergePdfPaths, listIndex, pdfMeta);

    }

   if (attachmentType === "XLSX") {
    // Screenshot the rendered HTML and embed it as a picture so the
    // attachment is a pixel-perfect copy of the template, rather than a
    // re-flowed text/table reconstruction.
    await preparePageForExport(page, pdfhtmlContent);
    const screenshotBuffer = await page.screenshot({ fullPage: true });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sheet 1');

    const imageId = workbook.addImage({
      buffer: screenshotBuffer,
      extension: 'png',
    });

    const { width, height } = getPngDimensions(screenshotBuffer);

    // Keep the picture at a readable width without stretching smaller images.
    // The reference workbook's picture transform is 794 px wide at 96 dpi.
    const scale = Math.min(1, 794 / width);
    const displayWidth = Math.round(width * scale);
    const displayHeight = Math.round(height * scale);
    const columnPixels = 64;
    const rowPixels = 20; // 15 points at 96 dpi
    const emusPerPixel = 9525;
    worksheet.properties.defaultRowHeight = 15;
    worksheet.views = [{ state: 'normal', zoomScale: 100, activeCell: 'A1' }];

    worksheet.addImage(imageId, {
      tl: { col: 0, row: 0 },
      // Native offsets avoid ExcelJS's approximate fractional-cell sizing.
      br: {
        nativeCol: Math.floor(displayWidth / columnPixels),
        nativeColOff: (displayWidth % columnPixels) * emusPerPixel,
        nativeRow: Math.floor(displayHeight / rowPixels),
        nativeRowOff: (displayHeight % rowPixels) * emusPerPixel,
      },
      editAs: 'twoCell',
    });

    // Leave cells empty: the floating picture needs no artificial used range.

    const xlsxBuffer = await workbook.xlsx.writeBuffer();
    fs.writeFileSync(xlsxFilePath, await stripOfficeMetadata(xlsxBuffer));

}


if (attachmentType === "PPTX") {
  await generatePptxFromHtml(
    page,
    pdfhtmlContent,
    pptxFilePath
  );
}





    if (attachmentType === "TXT") {
      fs.writeFileSync(txtFilePath, pdfhtmlContent);
    }

    if (attachmentType === "DOCX") {

      try {
        const buffer = await htmlToDocx(pdfhtmlContent, null, {
          table: { row: { cantSplit: true } },
          footer: true,
          pageNumber: true,
        });
        fs.writeFileSync(docxFilePath, buffer);
      } catch (err) {
        console.error("Error generating DOCX file:", err.message);
        throw err;
      }

    }


    if (attachmentType === "WKPDF") {
      await page.setContent(pdfhtmlContent); // optional: keeps parity with your current flow if you use Mustache in-page
      // direct render from string (no Chromium)
      await htmlToPdf({
        html: pdfhtmlContent,
        outPath: pdfFilePath,
        opts: [
          "--page-size", "A4",
          "--dpi", "96",
          // headers/footers example (uncomment to use):
          // "--header-spacing", "5",
          // "--header-center", "MyMail",
          // "--footer-right", "[page]/[toPage]"
        ]
      });

  
      await updatePdfMetadata(pdfFilePath, pdfMeta);
    }

    // ...existing code...
    if (attachmentType === "IMAGEHEIC") {
      await preparePageForExport(page, pdfhtmlContent);
      const screenshotBuffer = await page.screenshot({ fullPage: true, omitBackground: false });

      try {
        const sharp = require("sharp");
        const heicBuffer = await sharp(screenshotBuffer)
          .toFormat("heif", { compression: "av1", quality: 70 })
          .toBuffer();

        fs.writeFileSync(heicFilePath, heicBuffer);
      } catch (err) {
        console.warn("HEIC encoding failed, saving PNG instead:", err.message);
        fs.writeFileSync(pngFilePath, screenshotBuffer);
      }
      
      
      
    }


    // // ...existing code...

    });
  }
  } finally {
    reportProgress(false, true);
  }

}



 module.exports = generateAttachments;
