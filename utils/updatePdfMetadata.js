const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

const PDF_VERSION = '%PDF-1.4';


const toValidDate = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (typeof value === 'string' || typeof value === 'number') {
    const parsedDate = new Date(value);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  return null;
};


const updatePdfMetadata = async (filePath, meta = {}) => {
  try {
    const pdfBytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
    if (typeof meta.title === "string" && meta.title.trim()) {
      pdfDoc.setTitle(meta.title);
    }
    if (typeof meta.author === "string" && meta.author.trim()) {
      pdfDoc.setAuthor(meta.author);
    }
    if (typeof meta.subject === "string" && meta.subject.trim()) {
      pdfDoc.setSubject(meta.subject);
    }
    if (typeof meta.creator === "string" && meta.creator.trim()) {
      pdfDoc.setCreator(meta.creator);
    }
    if (typeof meta.producer === "string" && meta.producer.trim()) {
      pdfDoc.setProducer(meta.producer);
    }

    const creationDate = toValidDate(meta.creationDate);
    if (creationDate) pdfDoc.setCreationDate(creationDate);

    const modificationDate = toValidDate(meta.modificationDate || meta.modDate);
    if (modificationDate) pdfDoc.setModificationDate(modificationDate);
    
    let modifiedPdf = Buffer.from(await pdfDoc.save({ useObjectStreams: false }));
    const header = modifiedPdf.subarray(0, 8).toString('ascii');

    if (header.startsWith('%PDF-')) {
      Buffer.from(PDF_VERSION, 'ascii').copy(modifiedPdf, 0);
    }

    fs.writeFileSync(filePath, modifiedPdf);
  } catch (err) {
    console.error("Failed to update metadata:", err.message);
    throw err;
  }
};


module.exports = updatePdfMetadata;