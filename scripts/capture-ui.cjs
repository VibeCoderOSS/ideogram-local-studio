const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const renderer = path.join(root, "app", "renderer", "index.html");
const outDir = path.join(root, "design");
const captureView = process.env.CAPTURE_VIEW || "generation";
const outFile = path.join(outDir, captureView === "generation" ? "current-ui.png" : `current-${captureView}.png`);
const electronProfileDir = path.join(root, ".electron-profile-capture");

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(electronProfileDir, { recursive: true });

app.setPath("userData", electronProfileDir);
app.commandLine.appendSwitch("use-mock-keychain");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1536,
    height: 1024,
    useContentSize: true,
    show: false,
    backgroundColor: "#070d12",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  await win.loadFile(renderer);
  await wait(1600);
  if (captureView !== "generation") {
    await win.webContents.executeJavaScript(`
      (() => {
        const button = document.querySelector('[data-view="${captureView}"]');
        if (button) button.click();
      })();
    `);
    await wait(600);
  }
  const image = await win.webContents.capturePage();
  fs.writeFileSync(outFile, image.toPNG());
  console.log(outFile);
  app.quit();
});
