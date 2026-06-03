const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const { clipboard } = require("electron");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const workerPath = path.join(root, "backend", "worker.py");
const preloadPath = path.join(__dirname, "preload.cjs");
const rendererPath = path.join(root, "app", "renderer", "index.html");
const outputsDir = path.join(root, "outputs");
const logsDir = path.join(root, "logs");
const electronProfileDir = path.join(root, ".electron-profile");

fs.mkdirSync(outputsDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });
fs.mkdirSync(electronProfileDir, { recursive: true });

app.setPath("userData", electronProfileDir);
app.commandLine.appendSwitch("use-mock-keychain");

let mainWindow = null;
let worker = null;
let workerBuffer = "";
let currentJobResolve = null;
let currentJobReject = null;
let currentJobId = null;
let currentJobTimer = null;
let apiServer = null;
let apiPort = 7860;
let apiReady = false;

function preferredPython() {
  const candidates = [
    path.join(root, ".venv", "bin", "python"),
    path.join(root, ".venv", "bin", "python3"),
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    "/opt/anaconda3/bin/python3",
    "python3"
  ];
  return candidates.find((candidate) => {
    if (candidate === "python3") return true;
    return fs.existsSync(candidate);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1536,
    height: 1024,
    useContentSize: true,
    minWidth: 1180,
    minHeight: 760,
    title: "ImageGen Studio",
    backgroundColor: "#070d12",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 28, y: 24 },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(rendererPath);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function appendWorkerEvent(event) {
  try {
    fs.appendFileSync(path.join(logsDir, "worker-events.log"), `${JSON.stringify(event)}\n`);
  } catch {
    // Logging must never affect generation.
  }
}

function startWorker() {
  if (worker && !worker.killed) return worker;

  workerBuffer = "";
  const python = preferredPython();
  const env = {
    ...process.env,
    IDEOGRAM_STUDIO_ROOT: root,
    PYTHONPATH: [
      path.join(root, "vendor", "ideogram4", "src"),
      process.env.PYTHONPATH || ""
    ].filter(Boolean).join(path.delimiter),
    PYTHONUNBUFFERED: "1"
  };

  worker = spawn(python, [workerPath], {
    cwd: root,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });

  worker.stdout.on("data", (chunk) => {
    workerBuffer += chunk.toString();
    let newlineIndex = workerBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const raw = workerBuffer.slice(0, newlineIndex).trim();
      workerBuffer = workerBuffer.slice(newlineIndex + 1);
      newlineIndex = workerBuffer.indexOf("\n");
      if (!raw) continue;
      try {
        const event = JSON.parse(raw);
        handleWorkerEvent(event);
      } catch (error) {
        sendToRenderer("worker:log", { level: "stdout", message: raw });
      }
    }
  });

  worker.stderr.on("data", (chunk) => {
    const message = chunk.toString();
    fs.appendFileSync(path.join(logsDir, "worker-stderr.log"), message);
    sendToRenderer("worker:log", { level: "stderr", message });
  });

  worker.on("error", (error) => {
    sendToRenderer("worker:log", {
      level: "system",
      message: `Python worker failed to start: ${error.message}`
    });
    if (currentJobReject) finishCurrentJob(error);
    worker = null;
  });

  worker.on("exit", (code) => {
    sendToRenderer("worker:log", {
      level: "system",
      message: `Python worker exited with code ${code}`
    });
    if (currentJobReject) finishCurrentJob(new Error(`Python worker exited with code ${code}`));
    worker = null;
  });

  return worker;
}

function handleWorkerEvent(event) {
  appendWorkerEvent(event);
  sendToRenderer("generation:event", event);
  if ((event.type === "done" || event.type === "error") && currentJobId && event.jobId !== currentJobId) {
    sendToRenderer("worker:log", {
      level: "system",
      message: `Ignoring stale worker event for ${event.jobId}; active job is ${currentJobId}`
    });
    return;
  }
  if (event.type === "done" && currentJobResolve) {
    finishCurrentJob(null, event);
  }
  if (event.type === "error" && currentJobReject) {
    finishCurrentJob(new Error(event.message || "Generation failed"));
  }
}

function finishCurrentJob(error, event = null) {
  const resolve = currentJobResolve;
  const reject = currentJobReject;
  if (currentJobTimer) clearTimeout(currentJobTimer);
  currentJobResolve = null;
  currentJobReject = null;
  currentJobId = null;
  currentJobTimer = null;
  if (error && reject) {
    reject(error);
    return;
  }
  if (resolve) resolve(event);
}

function jobTimeoutMs(command) {
  if (command === "doctor") return 120_000;
  if (command === "generate") return 3_600_000;
  return 120_000;
}

function runWorkerCommand(command, payload = {}) {
  if (currentJobId || currentJobResolve || currentJobReject) {
    return Promise.reject(new Error(`Job ${currentJobId || "unknown"} is already running.`));
  }

  const proc = startWorker();
  const jobId = `${command}-${Date.now()}`;
  const request = {
    command,
    jobId,
    root,
    outputsDir,
    ...payload
  };

  return new Promise((resolve, reject) => {
    currentJobResolve = resolve;
    currentJobReject = reject;
    currentJobId = jobId;
    currentJobTimer = setTimeout(() => {
      finishCurrentJob(new Error(`Worker job timed out: ${jobId}`));
      if (worker && !worker.killed) worker.kill();
    }, jobTimeoutMs(command));

    if (proc.stdin.destroyed) {
      finishCurrentJob(new Error("Python worker stdin is closed."));
      return;
    }

    proc.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
      if (error) finishCurrentJob(error);
    });
  });
}

function systemInfo() {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    total,
    free,
    used: total - free,
    totalGb: total / 1024 ** 3,
    freeGb: free / 1024 ** 3,
    usedGb: (total - free) / 1024 ** 3,
    platform: process.platform,
    arch: process.arch,
    python: preferredPython(),
    paths: {
      root,
      fp8: path.join(root, "models", "ideogram-4-fp8"),
      nf4: path.join(root, "models", "ideogram-4-nf4"),
      outputs: outputsDir
    }
  };
}

function listGallery() {
  if (!fs.existsSync(outputsDir)) return [];
  return fs
    .readdirSync(outputsDir)
    .filter((name) => !name.startsWith("._") && /\.(png|jpe?g|webp)$/i.test(name))
    .map((name) => {
      const filePath = path.join(outputsDir, name);
      const stat = fs.statSync(filePath);
      return {
        name,
        path: filePath,
        url: `file://${filePath}`,
        size: stat.size,
        mtimeMs: stat.mtimeMs
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function resolveOutputImagePath(targetPath) {
  if (!targetPath) throw new Error("Missing output path.");
  const resolved = path.resolve(String(targetPath));
  const relative = path.relative(outputsDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Only files in the outputs folder can be deleted.");
  }
  if (!/\.(png|jpe?g|webp)$/i.test(resolved)) {
    throw new Error("Only generated image files can be deleted.");
  }
  if (!fs.existsSync(resolved)) {
    throw new Error("Output file does not exist.");
  }
  return resolved;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(payload));
}

function apiStatus() {
  return {
    running: apiReady,
    endpoint: `http://127.0.0.1:${apiPort}`,
    health: `http://127.0.0.1:${apiPort}/health`,
    generate: `http://127.0.0.1:${apiPort}/generate`,
    busy: Boolean(currentJobResolve || currentJobReject)
  };
}

function startApiServer() {
  if (apiServer) return;
  apiServer = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      if (req.method === "OPTIONS") {
        sendJson(res, 204, {});
        return;
      }
      if (req.method === "GET" && requestUrl.pathname === "/health") {
        sendJson(res, 200, { ok: true, ...apiStatus(), system: systemInfo() });
        return;
      }
      if (req.method === "GET" && requestUrl.pathname === "/gallery") {
        sendJson(res, 200, { ok: true, images: listGallery() });
        return;
      }
      if (req.method === "DELETE" && requestUrl.pathname.startsWith("/gallery/")) {
        const name = decodeURIComponent(requestUrl.pathname.replace(/^\/gallery\//, ""));
        const target = resolveOutputImagePath(path.join(outputsDir, path.basename(name)));
        await shell.trashItem(target);
        sendJson(res, 200, { ok: true, images: listGallery() });
        return;
      }
      if (req.method === "POST" && requestUrl.pathname === "/generate") {
        const body = await readRequestBody(req);
        const event = await runWorkerCommand("generate", body);
        sendJson(res, 200, { ok: true, result: event });
        return;
      }
      sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
  });

  apiServer.on("listening", () => {
    apiReady = true;
  });

  apiServer.on("error", (error) => {
    apiReady = false;
    if (error.code === "EADDRINUSE" && apiPort < 7870) {
      const failedServer = apiServer;
      apiServer = null;
      apiPort += 1;
      try {
        failedServer.close();
      } catch {
        // The failed listener may never have entered the listening state.
      }
      startApiServer();
      return;
    }
    sendToRenderer("worker:log", {
      level: "system",
      message: `API server failed: ${error.message}`
    });
  });

  apiServer.listen(apiPort, "127.0.0.1");
}

ipcMain.handle("system:info", () => systemInfo());
ipcMain.handle("api:status", () => apiStatus());
ipcMain.handle("gallery:list", () => listGallery());

ipcMain.handle("generation:start", async (_event, payload) => {
  return runWorkerCommand("generate", payload);
});

ipcMain.handle("generation:doctor", async () => {
  return runWorkerCommand("doctor", {});
});

ipcMain.handle("app:openPath", async (_event, targetPath) => {
  if (!targetPath) return;
  await shell.openPath(targetPath);
});

ipcMain.handle("app:showItem", async (_event, targetPath) => {
  if (!targetPath) return;
  shell.showItemInFolder(targetPath);
});

ipcMain.handle("app:copyText", async (_event, text) => {
  clipboard.writeText(String(text || ""));
  return true;
});

ipcMain.handle("app:trashItem", async (_event, targetPath) => {
  const resolved = resolveOutputImagePath(targetPath);
  await shell.trashItem(resolved);
  return { ok: true, images: listGallery() };
});

app.whenReady().then(() => {
  startApiServer();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  startApiServer();
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  if (worker && !worker.killed) worker.kill();
  if (apiServer) {
    apiServer.close();
    apiServer = null;
    apiReady = false;
  }
});
