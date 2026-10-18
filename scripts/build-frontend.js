const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const frontendDir = path.join(rootDir, "fn");
const frontendOutDir = path.join(frontendDir, "out");
const targetOutDir = path.join(rootDir, "out");

console.log("Building frontend (fn)...");
const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
  cwd: frontendDir,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error("Failed to start frontend build:", result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error("Frontend build failed.");
  process.exit(result.status ?? 1);
}

fs.rmSync(targetOutDir, { recursive: true, force: true });
fs.cpSync(frontendOutDir, targetOutDir, { recursive: true });
console.log("Copied fn/out -> out/");
