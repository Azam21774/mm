const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const frontendDir = path.join(rootDir, "fn");
const electronCommand = path.join(
  rootDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron",
);
const collectFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const entryPath = path.join(directory, entry.name);
  return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
});

const watchedFiles = [
  path.join(rootDir, "electron-main.js"),
  path.join(rootDir, "index.js"),
  path.join(rootDir, "preload.js"),
  path.join(rootDir, "server-process.js"),
  ...collectFiles(path.join(rootDir, "ipc")),
  ...collectFiles(path.join(rootDir, "utils")),
];

let electronProcess;
let restartTimer;
let shuttingDown = false;

const startElectron = () => {
  electronProcess = spawn(electronCommand, ["."], {
    cwd: rootDir,
    env: {
      ...process.env,
      ADMIN_API_URL: "http://127.0.0.1:3001",
      ELECTRON_DEV_SERVER_URL: "http://127.0.0.1:3000",
    },
    stdio: "inherit",
  });

  electronProcess.on("exit", (code, signal) => {
    electronProcess = undefined;
    if (!shuttingDown && code !== 0 && signal === null) {
      console.error(`Electron exited with code ${code}`);
    }
  });
};

const restartElectron = () => {
  if (shuttingDown) return;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (electronProcess) {
      electronProcess.kill();
    }
    startElectron();
  }, 300);
};

const watchers = watchedFiles.map((watchPath) => fs.watch(watchPath, restartElectron));

const frontendProcess = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3000"], {
  cwd: frontendDir,
  env: process.env,
  stdio: "inherit",
});

frontendProcess.on("error", (error) => {
  console.error("Failed to start frontend:", error.message);
});

startElectron();

const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(restartTimer);
  watchers.forEach((watcher) => watcher.close());
  frontendProcess.kill();
  if (electronProcess) electronProcess.kill();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", shutdown);
