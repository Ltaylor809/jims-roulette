import { app, BrowserWindow, ipcMain, shell } from "electron";
import updaterPackage from "electron-updater";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const { autoUpdater } = updaterPackage;
const electronDirectory = fileURLToPath(new URL(".", import.meta.url));
const appRoot = join(electronDirectory, "..");
const webRoot = join(appRoot, "dist");
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".fbx", "application/octet-stream"],
  [".glb", "model/gltf-binary"],
  [".gltf", "model/gltf+json"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wav", "audio/wav"],
  [".webp", "image/webp"],
]);

let launcherWindow = null;
let gameWindow = null;
let gameServer = null;
let gameUrl = "";
let quitting = false;
let updateReady = false;

function sendStatus(status, detail, progress = null) {
  launcherWindow?.webContents.send("launcher:status", { status, detail, progress });
}

function secureWindowOptions(overrides = {}) {
  return {
    show: false,
    backgroundColor: "#050303",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
      preload: join(electronDirectory, "preload.cjs"),
    },
    ...overrides,
  };
}

function restrictNavigation(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const current = window.webContents.getURL();
    if (current && new URL(url).origin !== new URL(current).origin) event.preventDefault();
  });
}

function createLauncher() {
  launcherWindow = new BrowserWindow(secureWindowOptions({
    width: 980,
    height: 620,
    minWidth: 800,
    minHeight: 560,
    frame: false,
    resizable: true,
    title: "Jims Roulette Launcher",
  }));
  restrictNavigation(launcherWindow);
  launcherWindow.loadFile(join(electronDirectory, "launcher.html"));
  launcherWindow.once("ready-to-show", () => launcherWindow?.show());
  launcherWindow.on("closed", () => {
    launcherWindow = null;
    if (!gameWindow) app.quit();
  });
}

function safeAssetPath(requestUrl) {
  const requested = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
  const relative = normalize(requested).replace(/^[/\\]+/, "");
  const candidate = join(webRoot, relative || "index.html");
  return candidate.startsWith(webRoot) ? candidate : join(webRoot, "index.html");
}

function startGameServer() {
  if (gameServer && gameUrl) return Promise.resolve(gameUrl);
  if (!existsSync(join(webRoot, "index.html"))) throw new Error("The packaged game build is missing. Run pnpm build first.");
  gameServer = createServer((request, response) => {
    let filePath = safeAssetPath(request.url ?? "/");
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(webRoot, "index.html");
    response.setHeader("Content-Type", mimeTypes.get(extname(filePath).toLowerCase()) ?? "application/octet-stream");
    response.setHeader("Cache-Control", filePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    createReadStream(filePath)
      .on("error", () => {
        response.statusCode = 404;
        response.end("Not found");
      })
      .pipe(response);
  });
  return new Promise((resolve, reject) => {
    gameServer.once("error", reject);
    gameServer.listen(0, "127.0.0.1", () => {
      const address = gameServer.address();
      if (!address || typeof address === "string") return reject(new Error("Could not bind the local game server."));
      gameUrl = `http://127.0.0.1:${address.port}`;
      resolve(gameUrl);
    });
  });
}

async function launchGame() {
  if (gameWindow) {
    gameWindow.show();
    gameWindow.focus();
    return;
  }
  const url = await startGameServer();
  gameWindow = new BrowserWindow(secureWindowOptions({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    autoHideMenuBar: true,
    title: "Jims Roulette",
  }));
  restrictNavigation(gameWindow);
  gameWindow.loadURL(url);
  gameWindow.once("ready-to-show", () => {
    launcherWindow?.hide();
    gameWindow?.show();
    sendStatus("TABLE OPEN", "LOCAL GAME PROCESS IS RUNNING", 100);
  });
  gameWindow.on("closed", () => {
    gameWindow = null;
    if (!quitting) {
      launcherWindow?.show();
      sendStatus("READY", "THE TABLE IS WAITING");
    }
  });
}

function configureUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => sendStatus("CHECKING", "CONTACTING GITHUB RELEASES"));
  autoUpdater.on("update-available", (info) => sendStatus("DOWNLOADING", `VERSION ${info.version} FOUND`, 0));
  autoUpdater.on("update-not-available", () => sendStatus("READY", "CURRENT BUILD IS UP TO DATE"));
  autoUpdater.on("download-progress", (progress) => sendStatus("DOWNLOADING", `${Math.round(progress.percent)}% / ${progress.transferred} BYTES`, progress.percent));
  autoUpdater.on("update-downloaded", (info) => {
    updateReady = true;
    sendStatus("UPDATE READY", `VERSION ${info.version} WILL INSTALL ON RESTART`, 100);
  });
  autoUpdater.on("error", (error) => sendStatus("OFFLINE", error.message || "UPDATE SERVER UNAVAILABLE"));
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    sendStatus("DEVELOPMENT BUILD", "UPDATE CHECKS ACTIVATE IN A PACKAGED RELEASE");
    return { packaged: false };
  }
  await autoUpdater.checkForUpdates();
  return { packaged: true };
}

ipcMain.handle("launcher:get-info", () => ({ version: app.getVersion(), packaged: app.isPackaged, updateReady }));
ipcMain.handle("launcher:play", async () => {
  await launchGame();
  return true;
});
ipcMain.handle("launcher:check", () => checkForUpdates());
ipcMain.handle("launcher:install", () => {
  if (updateReady) autoUpdater.quitAndInstall(false, true);
  return updateReady;
});
ipcMain.handle("launcher:quit", () => {
  quitting = true;
  app.quit();
});

app.whenReady().then(() => {
  configureUpdater();
  createLauncher();
  setTimeout(() => void checkForUpdates().catch(() => undefined), 900);
});

app.on("activate", () => {
  if (!launcherWindow && !gameWindow) createLauncher();
  else launcherWindow?.show();
});

app.on("before-quit", () => {
  quitting = true;
  gameServer?.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
