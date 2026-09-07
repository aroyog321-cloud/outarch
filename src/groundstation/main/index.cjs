const fs = require("node:fs");
const path = require("node:path");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  Notification,
  safeStorage,
  screen,
  shell
} = require("electron");
if (process.env.MISSION_CONTROL_VISUAL_CAPTURE_DIR) app.disableHardwareAcceleration();
const { EngineHost } = require("../../service/engineHost.cjs");
const { DiagnosticStore } = require("../../service/diagnosticStore.cjs");
const { ProjectCoordinator } = require("../../service/projectCoordinator.cjs");
const { ProjectRegistry } = require("../../service/projectRegistry.cjs");
const { GroundstationRecoveryService } = require("../../service/recoveryController.cjs");
const { RendererRecoverySupervisor } = require("../../service/rendererRecoverySupervisor.cjs");
const { VSCodeBridge } = require("../../service/vscodeBridge.cjs");
const { NotificationService } = require("../../service/notificationService.cjs");
const { PortInspector } = require("../../service/portInspector.cjs");
const { MissionContextService } = require("../../service/missionContext.cjs");
const { ProjectSupervisionService } = require("../../service/projectSupervision.cjs");
const { MissionAiCredentialStore } = require("../../service/missionAiCredentialStore.cjs");
const { MissionAIService } = require("../../service/missionAi.cjs");
const { MissionSupervisorService } = require("../../service/missionSupervisor.cjs");
const { McpGatewayStore } = require("../../service/mcpGatewayStore.cjs");
const { SecureMcpGateway } = require("../../service/mcpGateway.cjs");
const { MobileCompanionStore } = require("../../service/mobileCompanionStore.cjs");
const { MobileCompanionGateway } = require("../../service/mobileCompanion.cjs");
const { PluginPlatformStore } = require("../../service/pluginPlatformStore.cjs");
const { PermissionedPluginPlatform } = require("../../service/pluginPlatform.cjs");
const { createProtocolConnection } = require("../../protocol/connection.cjs");
const { GroundstationIpcHost } = require("./ipcHost.cjs");
const { parseGroundstationArgs } = require("./options.cjs");

let mainWindow = null;
let engineHost = null;
let ipcHost = null;
let notifications = null;
let portInspector = null;
let projectCoordinator = null;
let recoveryService = null;
let rendererRecovery = null;
let vscodeBridge = null;
let missionAi = null;
let missionSupervisor = null;
let projectSupervision = null;
let mcpGateway = null;
let mobileCompanion = null;
let pluginPlatform = null;
let shutdownComplete = false;
let shutdownInProgress = false;
let recoveryDialogOpen = false;
let rendererFailureDuringShutdown = null;
let visualCaptureStarted = false;

const VISUAL_CAPTURE_ROUTES = ["groundstation", "workspace", "needs", "agents", "recipes", "history", "settings", "integrations"];
const VISUAL_CAPTURE_THEMES = ["orbital", "solar", "contrast"];
const VISUAL_CAPTURE_VIEWPORTS = [
  // 720px remains an exploratory lower bound; production accepts 800x680.
  { width: 720, height: 900, label: "720" },
  { width: 800, height: 680, label: "800x680" },
  { width: 960, height: 680, label: "960x680" },
  { width: 1280, height: 900, label: "1280" },
  { width: 1600, height: 900, label: "1600" }
];

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function captureVisualMatrix(window, outputDirectory) {
  const target = path.resolve(outputDirectory);
  await fs.promises.mkdir(target, { recursive: true });
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (document.querySelector('.shell')) return resolve(true);
      if (Date.now() - started > 15000) return reject(new Error('Groundstation shell did not become ready'));
      setTimeout(poll, 100);
    };
    poll();
  })`);

  const captures = [];
  for (const viewport of VISUAL_CAPTURE_VIEWPORTS) {
    const { width, height, label } = viewport;
    window.setBounds({ width, height });
    await delay(120);
    for (const theme of VISUAL_CAPTURE_THEMES) {
      for (const route of VISUAL_CAPTURE_ROUTES) {
        const ready = await window.webContents.executeJavaScript(`(() => {
          const shell = document.querySelector('.shell');
          const destination = document.querySelector('[data-nav-id="${route}"]');
          if (!shell || !destination) return false;
          shell.classList.remove('theme-orbital', 'theme-solar', 'theme-contrast');
          shell.classList.add('theme-${theme}');
          destination.click();
          return true;
        })()`);
        if (!ready) throw new Error(`Visual capture route is unavailable: ${route}`);
        await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
          const started = Date.now();
          const poll = () => {
            if (document.querySelector('.experience.view-${route}')) return resolve(true);
            if (Date.now() - started > 10000) return reject(new Error('Route did not settle: ${route}'));
            setTimeout(poll, 50);
          };
          poll();
        })`);
        await window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
        // The first software-rendered capture can still expose Chromium's prior
        // compositor frame after a route swap. Prime it, then persist the next.
        await window.webContents.capturePage();
        await delay(50);
        const filename = `${label}-${theme}-${route}.png`;
        const image = await window.webContents.capturePage();
        await fs.promises.writeFile(path.join(target, filename), image.toPNG());
        captures.push({ filename, route, theme, width, height });
      }
    }
  }

  const cards = captures.map(item => `<figure><img loading="lazy" src="${item.filename}" alt="${item.route} in ${item.theme} at ${item.width} by ${item.height}px"><figcaption>${item.route} / ${item.theme} / ${item.width}x${item.height}px</figcaption></figure>`).join("\n");
  const contactSheet = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Mission Control visual matrix</title><style>body{margin:0;padding:24px;background:#101314;color:#edf2ef;font:13px Inter,system-ui,sans-serif}header{position:sticky;top:0;z-index:2;padding:12px 0 20px;background:#101314}h1{margin:0 0 5px;font-size:20px}p{margin:0;color:#a8b0ac}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px}figure{margin:0;padding:8px;border:1px solid #303735;background:#171b1a;border-radius:10px}img{display:block;width:100%;height:auto;border-radius:6px}figcaption{padding:8px 2px 2px;color:#c7ceca}</style><header><h1>Mission Control visual matrix</h1><p>8 routes / 3 themes / ${VISUAL_CAPTURE_VIEWPORTS.length} viewports / ${captures.length} captures</p></header><main class="grid">${cards}</main></html>`;
  await fs.promises.writeFile(path.join(target, "index.html"), contactSheet, "utf8");
  return { target, count: captures.length };
}

function rendererEntry() {
  return path.resolve(__dirname, "../../../dist/groundstation/renderer/index.html");
}

function loadRenderer(window) {
  const developmentUrl = process.env.MISSION_CONTROL_RENDERER_URL;
  if (developmentUrl && !app.isPackaged) {
    const parsed = new URL(developmentUrl);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
      return Promise.reject(new Error("MISSION_CONTROL_RENDERER_URL must use a loopback host"));
    }
    return window.loadURL(parsed.toString());
  }
  return window.loadFile(rendererEntry());
}

function beginRendererLoad(window) {
  if (rendererRecovery) return rendererRecovery.beginLoad();
  return loadRenderer(window);
}

async function showManualRecovery(window) {
  if (recoveryDialogOpen || shutdownInProgress || shutdownComplete || window.isDestroyed()) return;
  recoveryDialogOpen = true;
  let response;
  try {
    response = await dialog.showMessageBox(window, {
      type: "error",
      title: "Groundstation recovery paused",
      message: "Groundstation stopped reloading after repeated renderer failures.",
      detail: "Engine-owned workers are still supervised. Retry the desktop interface, or close Mission Control safely.",
      buttons: ["Retry Groundstation", "Close safely"],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
  } catch (error) {
    response = { response: 1 };
  } finally {
    recoveryDialogOpen = false;
  }
  if (response?.response === 0 && !window.isDestroyed()) {
    await rendererRecovery?.manualRetry();
  } else if (!window.isDestroyed()) {
    await shutdownAndClose(window);
  }
}

function scheduleRendererRecovery(window, details = {}) {
  return rendererRecovery?.recover(details) || Promise.resolve(false);
}

function createWindow(options = {}) {
  const visualCapture = Boolean(process.env.MISSION_CONTROL_VISUAL_CAPTURE_DIR);
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1480, Math.max(960, Math.floor(workArea.width * 0.94)));
  const height = Math.min(940, Math.max(640, Math.floor(workArea.height * 0.92)));
  const window = new BrowserWindow({
    width,
    height,
    // T139 — the renderer's responsive layer (redesign/*.css) collapses the
    // 2-column route splits and the recipe / attention-policy grids at
    // max-width: 900px, and the workspace title at 720px, with no page-level
    // horizontal scroll down to 720. 800 is the smallest fully-accepted width.
    minWidth: visualCapture ? 640 : Math.min(800, width),
    minHeight: Math.min(680, height),
    center: true,
    backgroundColor: "#080a09",
    title: "Mission Control Groundstation",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0a0b0d",
      symbolColor: "#cbd0dc",
      height: 42
    },
    show: false,
    webPreferences: {
      preload: path.resolve(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  window.removeMenu();
  window.once("ready-to-show", () => {
    if (visualCapture) return;
    window.maximize();
    window.show();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  window.webContents.on("will-attach-webview", event => event.preventDefault());
  window.webContents.on("before-input-event", (event, input) => {
    if (!app.isPackaged && input.control && input.shift && input.key.toLowerCase() === "i") {
      window.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    if (shutdownComplete) return;
    if (shutdownInProgress) {
      rendererFailureDuringShutdown = details || {};
      return;
    }
    void scheduleRendererRecovery(window, details || {});
  });
  window.webContents.on("did-finish-load", () => {
    rendererRecovery?.rendererLoaded();
    const outputDirectory = process.env.MISSION_CONTROL_VISUAL_CAPTURE_DIR;
    if (!outputDirectory || visualCaptureStarted) return;
    visualCaptureStarted = true;
    void captureVisualMatrix(window, outputDirectory)
      .then(result => console.log(`Captured ${result.count} Groundstation views to ${result.target}`))
      .then(() => shutdownAndClose(window))
      .catch(error => {
        console.error(`Visual capture failed: ${error.message}`);
        process.exitCode = 1;
        void shutdownAndClose(window);
      });
  });

  window.on("close", event => {
    if (shutdownComplete) return;
    event.preventDefault();
    void shutdownAndClose(window);
  });

  rendererRecovery?.dispose();
  rendererRecovery = recoveryService
    ? new RendererRecoverySupervisor({
        recoveryService,
        loadRenderer: () => loadRenderer(window),
        disposeConnection: () => ipcHost?.disposeConnection(window.webContents.id),
        onPaused: () => showManualRecovery(window),
        isBlocked: () => shutdownInProgress || shutdownComplete || window.isDestroyed()
      })
    : null;
  if (options.load !== false) void beginRendererLoad(window);
  return window;
}

function pendingOverlayIcon(count) {
  const label = count > 9 ? "9+" : String(count);
  const size = label.length > 1 ? 10 : 12;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#eaa544" stroke="#11151c" stroke-width="2"/><text x="16" y="21" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="${size}" font-weight="700" fill="#11151c">${label}</text></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`).resize({ width: 16, height: 16 });
}

function assertTrustedMainFrame(event) {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event?.sender !== mainWindow.webContents ||
    (event.senderFrame && event.senderFrame !== event.sender.mainFrame)
  ) {
    throw new Error("IPC request is accepted only from the Groundstation main frame");
  }
}

async function shutdownAndClose(window) {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  let result;
  try {
    try { notifications?.stop(); } catch { /* Engine shutdown remains authoritative. */ }
    try { await mcpGateway?.stop(); } catch { /* Engine shutdown remains authoritative. */ }
    try { await mobileCompanion?.stop(); } catch { /* Engine shutdown remains authoritative. */ }
    result = await engineHost.shutdown();
  } catch (error) {
    result = {
      ok: false,
      error: "Unexpected engine shutdown error",
      pendingIds: []
    };
  } finally {
    shutdownInProgress = false;
  }
  if (!result.ok) {
    recoveryService?.shutdownFailed();
    const ids = Array.isArray(result.pendingIds) ? result.pendingIds.join(", ") : "";
    try {
      await dialog.showMessageBox(window, {
        type: "error",
        title: "Mission Control is still supervising workers",
        message: "Groundstation could not safely stop every PTY.",
        detail: ids ? `Still running: ${ids}` : result.error || "Unknown shutdown failure"
      });
    } catch (error) {
      // Native dialog failure must not strand a renderer that also crashed
      // during shutdown; the recovery path below remains authoritative.
    }
    if (rendererFailureDuringShutdown) {
      const failure = rendererFailureDuringShutdown;
      rendererFailureDuringShutdown = null;
      void scheduleRendererRecovery(window, failure);
    }
    return result;
  }

  shutdownComplete = true;
  rendererFailureDuringShutdown = null;
  rendererRecovery?.dispose();
  missionAi?.dispose();
  void mcpGateway?.dispose();
  void mobileCompanion?.dispose();
  pluginPlatform?.dispose();
  vscodeBridge?.dispose();
  // Keep the process-wide IPC handler bound through WebContents teardown.
  // Renderer effects can have invokes already queued when destroy() runs;
  // removing the handler here turns an otherwise clean shutdown into false
  // "No handler registered" failures. The operating system reclaims the
  // process-scoped handler immediately after `window-all-closed`; per-renderer
  // protocol connections are independently disposed by the WebContents
  // `destroyed` hook, reload handling and recovery.
  window.destroy();
  return result;
}

async function start() {
  let options;
  try {
    const argv = process.argv.slice(app.isPackaged ? 1 : 2);
    options = parseGroundstationArgs(argv);
  } catch (error) {
    dialog.showErrorBox("Mission Control could not start", error.message);
    app.quit();
    return;
  }

  engineHost = new EngineHost();
  vscodeBridge = new VSCodeBridge({
    getWorkspace: () => engineHost?.engineApi?.getWorkspace?.() || null,
    openExternal: uri => shell.openExternal(uri)
  });
  const missionContext = new MissionContextService({
    getEngineApi: () => engineHost?.engineApi || null,
    getVSCodeStatus: () => vscodeBridge?.status?.() || null
  });
  projectSupervision = new ProjectSupervisionService({ missionContext });
  missionAi = new MissionAIService({
    credentialStore: new MissionAiCredentialStore(
      path.join(app.getPath("userData"), "mission-ai-credentials.json"),
      { safeStorage }
    ),
    missionContext,
    projectSupervision
  });
  missionSupervisor = new MissionSupervisorService({
    missionAi,
    getEngineApi: () => engineHost?.engineApi || null
  });
  mcpGateway = new SecureMcpGateway({
    store: new McpGatewayStore(
      path.join(app.getPath("userData"), "mcp-gateway-credentials.json"),
      { safeStorage }
    ),
    missionContext,
    projectSupervision,
    missionSupervisor,
    getEngineApi: () => engineHost?.engineApi || null
  });
  mobileCompanion = new MobileCompanionGateway({
    store: new MobileCompanionStore(
      path.join(app.getPath("userData"), "mobile-companion-credentials.json"),
      { safeStorage }
    ),
    missionContext,
    getEngineApi: () => engineHost?.engineApi || null
  });
  pluginPlatform = new PermissionedPluginPlatform({
    store: new PluginPlatformStore(path.join(app.getPath("userData"), "plugin-platform.json")),
    missionContext,
    getEngineApi: () => engineHost?.engineApi || null,
    chooseManifest: async () => {
      const options = {
        title: "Install a Mission Control plugin manifest",
        buttonLabel: "Inspect manifest",
        properties: ["openFile"],
        filters: [{ name: "Mission Control plugin manifest", extensions: ["json"] }]
      };
      const result = mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return null;
      const filePath = result.filePaths[0];
      const raw = fs.readFileSync(filePath);
      if (raw.length > 256 * 1024) throw new Error("Plugin manifest exceeds the 256 KiB limit");
      let manifest;
      try { manifest = JSON.parse(raw.toString("utf8")); }
      catch { throw new Error("Plugin manifest is not valid JSON"); }
      return { manifest, source: path.basename(filePath) };
    }
  });
  ipcMain.handle("mission-control:open-external", async (event, url) => {
    assertTrustedMainFrame(event);
    const allowed = new Set(["https://github.com/radix-ui/primitives", "https://github.com/pacocoursey/cmdk"]);
    if (!allowed.has(url)) throw new Error("External resource is not allow-listed");
    await shell.openExternal(url);
    return true;
  });
  ipcMain.handle("mission-control:set-pending-badge", async (event, rawCount) => {
    assertTrustedMainFrame(event);
    const count = Number(rawCount);
    if (!Number.isInteger(count) || count < 0 || count > 999) throw new TypeError("pending badge count must be an integer from 0 to 999");
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (process.platform === "win32") {
      mainWindow.setOverlayIcon(count ? pendingOverlayIcon(count) : null, count ? `${count} decisions need attention` : "No pending decisions");
    } else if (typeof app.setBadgeCount === "function") {
      app.setBadgeCount(count);
    }
    return true;
  });
  recoveryService = new GroundstationRecoveryService({
    store: new DiagnosticStore(path.join(app.getPath("userData"), "recovery-diagnostics.json"))
  });
  const projectRegistry = new ProjectRegistry(path.join(app.getPath("userData"), "projects.json"));
  projectCoordinator = new ProjectCoordinator({
    engineHost,
    registry: projectRegistry,
    chooseDirectory: async () => {
      const dialogOptions = {
        title: "Open a project in Mission Control",
        buttonLabel: "Choose project",
        properties: ["openDirectory", "createDirectory"]
      };
      const result = mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      return result.canceled ? null : result.filePaths[0] || null;
    }
  });
  try {
    const startupOptions = projectCoordinator.resolveStartupOptions(options);
    await engineHost.open(startupOptions);
    try {
      projectCoordinator.rememberCurrent();
    } catch (registryError) {
      projectCoordinator.lastWarning = registryError instanceof Error
        ? registryError.message
        : String(registryError);
    }
  } catch (error) {
    dialog.showErrorBox("Mission Control could not open the workspace", error.message);
    app.quit();
    return;
  }

  mainWindow = createWindow({ load: false });
  // T033/T036 — the notifier is main-process because only the main process owns
  // the OS notification surface and the window a click has to bring forward.
  notifications = new NotificationService({
    Notification,
    getEngineApi: () => engineHost?.engineApi || null,
    focusWindow: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  notifications.start();
  // T026 — read-only port-owner inspection. It is given the engine only so it
  // can prove ownership; it has no path that terminates anything.
  portInspector = new PortInspector({ getEngineApi: () => engineHost?.engineApi || null });
  ipcHost = new GroundstationIpcHost({
    ipcMain,
    getEngineApi: () => engineHost.engineApi,
    createProtocolConnection,
    onShutdown: () => shutdownAndClose(mainWindow),
    projectService: projectCoordinator,
    recoveryService,
    vscodeBridge,
    missionAi,
    missionSupervisor,
    projectSupervision,
    mcpGateway,
    mobileCompanion,
    pluginPlatform,
    notifications,
    portInspector
  });
  ipcHost.bind();
  try { await mcpGateway.start(); }
  catch (error) { mcpGateway.lastError = error instanceof Error ? error.message : String(error); }
  try { await mobileCompanion.start(); }
  catch (error) { mobileCompanion.lastError = error instanceof Error ? error.message : String(error); }
  void beginRendererLoad(mainWindow);
}

app.whenReady().then(start).catch(async error => {
  recoveryService?.mainFailed("startup-failure");
  missionAi?.dispose();
  await mcpGateway?.dispose();
  await mobileCompanion?.dispose();
  pluginPlatform?.dispose();
  vscodeBridge?.dispose();
  try {
    await engineHost?.shutdown();
  } catch (shutdownError) {
    // Startup reporting must still complete if cleanup itself throws.
  }
  dialog.showErrorBox("Mission Control crashed during startup", error.message);
  app.quit();
});

app.on("window-all-closed", () => {
  if (shutdownComplete) app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && engineHost?.isOpen) {
    mainWindow = createWindow();
  }
});

// Observe fatal main-process exceptions without changing Node's default fatal
// behavior. The durable record contains only an allow-listed classification;
// exception text, paths, commands, output, and environment values are omitted.
process.on("uncaughtExceptionMonitor", () => {
  recoveryService?.mainFailed("uncaught-exception");
});

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", event => event.preventDefault());
});

module.exports = {
  beginRendererLoad,
  captureVisualMatrix,
  createWindow,
  loadRenderer,
  rendererEntry,
  scheduleRendererRecovery,
  shutdownAndClose
};
