// utils/wkhtml.js
const { spawn } = require("child_process");
const fs = require("fs");

const WK = process.env.WKHTMLTOPDF_PATH || "wkhtmltopdf";

// html => pdf (write to file)
function htmlToPdf({ html, outPath, opts = [] }) {
  return new Promise((resolve, reject) => {
    const args = [
      "--quiet",
      "--enable-local-file-access",
      "--print-media-type",
      "--encoding", "utf-8",
      // margins (tweak as you like)
      "--margin-top", "10mm",
      "--margin-bottom", "10mm",
      "--margin-left", "10mm",
      "--margin-right", "10mm",
      ...opts,
      "-",            // stdin (html)
      outPath         // output pdf
    ];

    const child = spawn(WK, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";

    child.on("error", (err) => {
      if (err.code === "ENOENT") {
        return reject(new Error("wkhtmltopdf binary not found. Install wkhtmltopdf or set WKHTMLTOPDF_PATH."));
      }

      reject(err);
    });

    child.stdin.write(html);
    child.stdin.end();

    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code === 0 && fs.existsSync(outPath)) return resolve(outPath);
      reject(new Error(`wkhtmltopdf failed (code ${code}): ${stderr}`));
    });
  });
}

module.exports = { htmlToPdf };