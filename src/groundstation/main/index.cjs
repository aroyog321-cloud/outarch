const fs = require("node:fs");
const path = require("node:path");
const {
  app,
  BrowserWindow,
  clipboard,
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
const { ProjectRegistry, projectIdFor } = require("../../service/projectRegistry.cjs");
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
const { MissionAIConversation } = require("../../service/missionAiConversation.cjs");
const { BuiltinMissionAiCredentials } = require("../../service/missionAiBuiltinKeys.cjs");
const { ByokStore } = require("../../service/byokStore.cjs");
const { AiAssistant } = require("../../service/aiAssistant.cjs");
const { ProjectMemoryFile } = require("../../service/projectMemoryFile.cjs");
const { NotificationCenter, fromAttentionRecord, fromSemanticEvent } = require("../../service/notificationCenter.cjs");
const { SessionJournal } = require("../../service/sessionJournal.cjs");
const { SessionRecoveryService } = require("../../service/sessionRecoveryService.cjs");
const { CliUsageImporter } = require("../../service/usageCliImport.cjs");
const { createProtocolConnection } = require("../../protocol/connection.cjs");
const { GroundstationIpcHost } = require("./ipcHost.cjs");
const { parseGroundstationArgs } = require("./options.cjs");
const { WorkspaceIntelligence } = require("./workspaceIntelligence.cjs");
const { TerminalWindowManager } = require("./terminalWindowManager.cjs");
const { WorkspaceBrowser } = require("./workspaceBrowser.cjs");
const { execFile } = require("node:child_process");
const { APP_USER_MODEL_ID, ASSETS: BRAND_ASSETS, PRODUCT_NAME } = require("../../brand/index.cjs");
const { registerWindowsAppIdentity, resolveUserDataHome } = require("./appIdentity.cjs");
const { STORE_DISTRIBUTION, resolveDistribution, storeLaunchDirectory } = require("./distribution.cjs");
const { cloudConfig } = require("../../service/cloudConfig.cjs");
const { SupabaseRest } = require("../../service/supabaseRest.cjs");
const { AccountSessionStore } = require("../../service/accountSessionStore.cjs");
const { LegalAcceptanceStore } = require("../../service/legalAcceptanceStore.cjs");
const { AccountService, isDeepLink } = require("../../service/accountService.cjs");
const { createManagedAiFetch } = require("../../service/managedAiTransport.cjs");
const { UpdateService } = require("../../service/updateService.cjs");
const { UPDATE_PUBLIC_KEY } = require("../../service/updateConfig.cjs");
const APP_VERSION = require("../../../package.json").version;
// A folder install or a Microsoft Store package (see distribution.cjs).
const DISTRIBUTION = resolveDistribution({ packageJson: require("../../../package.json") });

// OUTARCH's own data folder and name. Both are settled before anything asks
// Electron for a path or takes the single-instance lock, which is keyed on
// the data folder. The first launch carries the pre-OUTARCH data across.
const userDataHome = resolveUserDataHome({ appData: app.getPath("appData") });
app.setPath("userData", userDataHome.directory);
if (userDataHome.error) console.warn(`${PRODUCT_NAME} kept its previous data folder: ${userDataHome.error}`);
app.setName(PRODUCT_NAME);
// A Store package already has its identity from the package; claiming another
// id would split its taskbar button from its Start entry.
if (!DISTRIBUTION.store) {
  if (process.platform === "win32") app.setAppUserModelId(APP_USER_MODEL_ID);
}
// Windows starts a packaged app in System32 or its read-only install folder;
// the first terminal opens in the home folder instead.
if (DISTRIBUTION.store) {
  const launchDirectory = storeLaunchDirectory({ cwd: process.cwd(), home: app.getPath("home"), executable: process.execPath });
  if (launchDirectory) {
    try { process.chdir(launchDirectory); } catch { /* the launch folder stays */ }
  }
}

// One OUTARCH at a time: opening it again brings the running window forward
// instead of failing on the project that window already holds. A launch that
// names a project (--config) is a deliberate second workspace and runs on
// its own, as does a visual capture run.
const namesProject = process.argv.some(argument => argument === "-c" || argument === "--config" || argument.startsWith("--config="));
const holdsInstanceLock = namesProject || Boolean(process.env.MISSION_CONTROL_VISUAL_CAPTURE_DIR) || app.requestSingleInstanceLock();
if (!holdsInstanceLock) app.quit();

let mainWindow = null;
// The main window's native controls. Focus mode asks for a shallower strip so
// the controls cost the terminal canvas as little as possible; the renderer
// reserves whatever height the overlay reports, so the two cannot disagree.
// The colour is the status tape's as painted (its surface at 94% over black);
// the renderer sends the exact value once it has drawn the tape.
const MAIN_TITLE_BAR_OVERLAY = Object.freeze({ color: "#161616", symbolColor: "#cbd0dc", height: 42 });
const FOCUS_TITLE_BAR_HEIGHT = 32;
const WINDOW_CHROME_COLOR = /^#[0-9a-f]{6}$/i;
let windowChrome = { mode: "standard", color: MAIN_TITLE_BAR_OVERLAY.color };
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
let workspaceIntelligence = null;
let terminalWindowManager = null;
let workspaceBrowser = null;
let missionAiConversation = null;
let aiAssistant = null;
// arch_memory.md for the open project, and the ask-before-closing check.
let projectMemory = null;
let byokStore = null;
let notificationCenter = null;
let cliUsageImporter = null;
// The signed-in account and the plan it holds, and the auto-updater.
let accountService = null;
let updateService = null;
let cloud = null;
// Set when OUTARCH was started by the website handing a sign-in back.
const launchDeepLink = process.argv.find(argument => isDeepLink(argument, "outarch")) || null;
// What the previous session left behind, read before the engine can relaunch
// anything. Held here so the renderer can ask for it after it connects.
let recoveryReport = null;
const detachedTerminalWindows = new Set();
let shutdownComplete = false;
let shutdownInProgress = false;
let recoveryDialogOpen = false;
let rendererFailureDuringShutdown = null;
let visualCaptureStarted = false;

// Agents is no longer a destination — an AI agent is a classification a terminal
// carries, shown in the Workspace folder and the Groundstation register.
const VISUAL_CAPTURE_ROUTES = ["groundstation", "workspace", "needs", "recipes", "history", "settings", "integrations"];
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
  const contactSheet = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>OUTARCH visual matrix</title><style>body{margin:0;padding:24px;background:#101314;color:#edf2ef;font:13px Inter,system-ui,sans-serif}header{position:sticky;top:0;z-index:2;padding:12px 0 20px;background:#101314}h1{margin:0 0 5px;font-size:20px}p{margin:0;color:#a8b0ac}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px}figure{margin:0;padding:8px;border:1px solid #303735;background:#171b1a;border-radius:10px}img{display:block;width:100%;height:auto;border-radius:6px}figcaption{padding:8px 2px 2px;color:#c7ceca}</style><header><h1>OUTARCH visual matrix</h1><p>8 routes / 3 themes / ${VISUAL_CAPTURE_VIEWPORTS.length} viewports / ${captures.length} captures</p></header><main class="grid">${cards}</main></html>`;
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

// A detached terminal loads the same renderer bundle in pop-out mode. The query
// is routing only — the main process already decided which worker this window
// is for, and the per-window protocol connection is what actually scopes it.
function loadPopoutRenderer(window, spec) {
  const query = {
    popout: "1",
    worker: spec.workerId,
    slot: String(spec.detachedSlot),
    name: spec.workerName || spec.workerId
  };
  const developmentUrl = process.env.MISSION_CONTROL_RENDERER_URL;
  if (developmentUrl && !app.isPackaged) {
    const parsed = new URL(developmentUrl);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
      return Promise.reject(new Error("MISSION_CONTROL_RENDERER_URL must use a loopback host"));
    }
    for (const [key, value] of Object.entries(query)) parsed.searchParams.set(key, value);
    return window.loadURL(parsed.toString());
  }
  return window.loadFile(rendererEntry(), { query });
}

// Saved or default bounds are clamped to a display that still exists, so a
// terminal cannot be stranded offscreen after a monitor is unplugged.
function clampToWorkArea(width, height) {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor) || screen.getPrimaryDisplay();
  const area = display.workArea;
  const clampedWidth = Math.max(320, Math.min(width, area.width));
  const clampedHeight = Math.max(240, Math.min(height, area.height));
  // Cascade the windows slightly so three pop-outs do not land exactly on top.
  const offset = detachedTerminalWindows.size * 28;
  return {
    width: clampedWidth,
    height: clampedHeight,
    x: Math.round(area.x + Math.min(offset, Math.max(0, area.width - clampedWidth))),
    y: Math.round(area.y + Math.min(offset, Math.max(0, area.height - clampedHeight)))
  };
}

// Service and usage records are scoped to a project, so discovery has to be
// keyed by the same identity the rest of the app uses.
function currentProjectId() {
  try {
    const id = projectCoordinator?.list?.().currentProjectId;
    if (id) return id;
  } catch {
    // A registry read failure must not stop the engine from being observed.
  }
  return engineHost?.currentOptions?.cwd || "default";
}

// Switching projects replaces the EngineAPI instance. Discovery has to follow
// it, or the panels keep describing workers that belong to the previous
// workspace.
// A worker that starts again is a fresh attempt, so its last incident must not
// swallow what it reports now. Bound to the current EngineAPI, and re-bound
// when a project switch replaces it.
let unbindIncidentMemory = null;
function bindIncidentMemory() {
  try { unbindIncidentMemory?.(); } catch { /* the old engine may already be disposed */ }
  unbindIncidentMemory = null;
  // Whether each worker's attention was raised at its last supervision event,
  // so a Windows toast is taken back only when a raised alert actually clears
  // (acknowledged, recovered or reset), not on every progress line.
  const raised = new Map();
  try {
    unbindIncidentMemory = engineHost?.engineApi?.subscribe?.("all", event => {
      const workerId = event?.sessionId || event?.id;
      if (!workerId) return;
      if (event.type === "session:status" && ["running", "starting"].includes(event.status)) {
        notificationCenter?.forgetWorker(currentProjectId(), workerId);
      } else if (event.type === "session:supervision") {
        const now = event.attentionRequired === true;
        if (raised.get(workerId) === true && !now) notificationCenter?.withdrawWorker(workerId);
        raised.set(workerId, now);
      } else if (event.type === "session:removed") {
        raised.delete(workerId);
      }
    }) || null;
  } catch { /* incident memory is a refinement, not a requirement */ }
}

async function rebindWorkspaceIntelligence() {
  // Notifications follow the new engine first: the subscriptions on the old
  // one would never hear another failure.
  try {
    notificationCenter?.forgetAll();
    notifications?.rebind();
    bindIncidentMemory();
  } catch { /* a notification rebind must not block the project switch */ }
  if (!workspaceIntelligence) return;
  await terminalWindowManager?.recallAll();
  // A preview points at a service of the project being closed; leaving it up
  // would keep showing a page whose worker is gone.
  workspaceBrowser?.close();
  const engineApi = engineHost?.engineApi || null;
  try { workspaceIntelligence.markCleanShutdown(); } catch {}
  if (engineApi) {
    workspaceIntelligence.beginSession(currentProjectId());
    workspaceIntelligence.attachEngine(engineApi, currentProjectId());
  }
  else workspaceIntelligence.detachEngine();
  ipcHost?.broadcast({ type: "services:changed", detail: "project:switched" });
  projectMemory?.observe(engineApi);
  ipcHost?.broadcast({ type: "projectMemory:changed" });
}

async function createDetachedTerminalWindow(spec) {
  const bounds = clampToWorkArea(spec.width, spec.height);
  const window = new BrowserWindow({
    ...bounds,
    minWidth: spec.minWidth,
    minHeight: spec.minHeight,
    backgroundColor: "#080a09",
    icon: BRAND_ASSETS.windowIcon,
    title: `${spec.workerName} — ${PRODUCT_NAME}`,
    titleBarStyle: "hidden",
    // A shallow strip, per the detached-terminal sketch: the terminal is the
    // content, the chrome is only deep enough for identity and window controls.
    titleBarOverlay: {
      color: "#171717",
      symbolColor: "#cbd0dc",
      height: 32
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
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  window.webContents.on("will-attach-webview", event => event.preventDefault());
  window.webContents.on("before-input-event", (event, input) => {
    if (!app.isPackaged && input.control && input.shift && input.key.toLowerCase() === "i") {
      window.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  detachedTerminalWindows.add(window);
  window.once("closed", () => detachedTerminalWindows.delete(window));
  window.once("ready-to-show", () => window.show());

  try {
    await loadPopoutRenderer(window, spec);
  } catch (error) {
    detachedTerminalWindows.delete(window);
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
  return window;
}

// An operator who pasted a Gemini key into the old Mission AI settings did not
// lose it when Mission AI moved to built-in keys: the first launch after the
// change copies it into their own keys, where it is still theirs to use and
// to remove. Best effort, once — a key the provider now refuses is left alone.
async function migrateLegacyMissionAiKey() {
  const legacyPath = path.join(app.getPath("userData"), "mission-ai-credentials.json");
  const marker = `${legacyPath}.carried-over`;
  try {
    if (!fs.existsSync(legacyPath) || fs.existsSync(marker)) return;
    const legacy = new MissionAiCredentialStore(legacyPath, { safeStorage });
    if (!legacy.status().configured) return;
    for (const slot of ["primary", "secondary"]) {
      let key;
      try { key = legacy.apiKey(slot); } catch { continue; }
      try { await aiAssistant.addKey({ apiKey: key, provider: "gemini", label: slot === "primary" ? "Gemini (from Mission AI settings)" : "Gemini fallback (from Mission AI settings)" }); }
      catch { /* already saved, refused, or offline: nothing to carry */ }
    }
    fs.writeFileSync(marker, `${new Date().toISOString()}\n`, "utf8");
  } catch {
    // A failed carry-over costs nothing: the operator can add the key again.
  }
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
      detail: "Engine-owned workers are still supervised. Retry the desktop interface, or close OUTARCH safely.",
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
  // A new window starts with the standard strip; a renderer that is replaced
  // mid focus mode must not hand its successor a 32px strip.
  windowChrome = { ...windowChrome, mode: "standard" };
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
    icon: BRAND_ASSETS.windowIcon,
    title: PRODUCT_NAME,
    titleBarStyle: "hidden",
    titleBarOverlay: { ...MAIN_TITLE_BAR_OVERLAY, color: windowChrome.color },
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
    void requestClose(window);
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

// The main window or one of its terminal pop-outs, and only their top frame.
function assertTrustedAppFrame(event) {
  const sender = event?.sender;
  const owner = sender ? BrowserWindow.fromWebContents(sender) : null;
  const known = Boolean(owner && !owner.isDestroyed() && (owner === mainWindow || detachedTerminalWindows.has(owner)));
  if (!known || (event.senderFrame && event.senderFrame !== sender.mainFrame)) {
    throw new Error("IPC request is accepted only from an OUTARCH window");
  }
}

const MAX_COPY_CHARACTERS = 8 * 1024 * 1024;

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

// Every OUTARCH window hears account and update changes; neither carries a token.
function sendToWindows(channel, payload) {
  for (const window of [mainWindow, ...detachedTerminalWindows]) {
    if (!window || window.isDestroyed()) continue;
    try { window.webContents.send(channel, payload); } catch { /* the window is closing */ }
  }
}

// outarch:// links open this app. An unpackaged build registers the Electron
// binary with this script, so the link reaches the same app the launcher runs.
function registerDeepLinkProtocol() {
  if (process.env.MISSION_CONTROL_VISUAL_CAPTURE_DIR) return;
  // The Store package's manifest registers outarch:// for the installed version.
  if (DISTRIBUTION.store) return;
  try {
    if (app.isPackaged) app.setAsDefaultProtocolClient("outarch");
    else app.setAsDefaultProtocolClient("outarch", process.execPath, [path.resolve(__filename)]);
  } catch {
    // Without the registration the website shows a "copy link" fallback.
  }
}

// What the plan allows, applied to the services that run in the background.
// Called on every account change: a downgrade takes effect at once, an
// upgrade starts whatever the operator had already turned on.
function applyPlanToServices() {
  if (!accountService) return;
  const gate = accountService.entitlements();
  const limits = gate.limits;
  if (gate.mcpLevel() === "none") void mcpGateway?.stop().catch(() => {});
  else void mcpGateway?.start().catch(error => { if (mcpGateway) mcpGateway.lastError = error instanceof Error ? error.message : String(error); });
  if (!limits.mobileCompanion) void mobileCompanion?.stop().catch(() => {});
  else void mobileCompanion?.start().catch(error => { if (mobileCompanion) mobileCompanion.lastError = error instanceof Error ? error.message : String(error); });
  if (!limits.vscodeBridge) {
    try { vscodeBridge?.disconnect?.("plan"); } catch { /* not connected */ }
  }
  // The model menu shows which of the operator's own keys the plan lets answer.
  try { aiAssistant?.emit("change", { scope: "keys" }); } catch { /* not ready yet */ }
}

// Closing the window asks first when project memory has something to record:
// the dialog in the window then closes the app itself through system.shutdown.
// Anything that goes wrong while asking closes the app as it always did.
async function requestClose(window) {
  if (shutdownInProgress) return;
  let decision = "close";
  if (window === mainWindow && projectMemory && !process.env.MISSION_CONTROL_VISUAL_CAPTURE_DIR) {
    try { decision = await projectMemory.requestClose(); } catch { decision = "close"; }
  }
  if (decision === "close") await shutdownAndClose(window);
}

async function shutdownAndClose(window) {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  let result;
  try {
    try { notifications?.stop(); } catch { /* Engine shutdown remains authoritative. */ }
    // Pop-outs are views, not processes: closing them first keeps the quit from
    // racing with a window that would otherwise try to recall mid-shutdown.
    try { await terminalWindowManager?.recallAll(); } catch { /* Engine shutdown remains authoritative. */ }
    try { workspaceIntelligence?.markCleanShutdown(); } catch { /* Engine shutdown remains authoritative. */ }
    try { workspaceIntelligence?.dispose(); } catch { /* Engine shutdown remains authoritative. */ }
    try { notificationCenter?.dispose(); } catch { /* Engine shutdown remains authoritative. */ }
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
        title: "OUTARCH is still supervising workers",
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
  updateService?.dispose();
  accountService?.dispose();
  missionAi?.dispose();
  // Commands the assistant is running in its private terminal end with the app.
  aiAssistant?.dispose();
  void mcpGateway?.dispose();
  void mobileCompanion?.dispose();
  vscodeBridge?.dispose();
  // The browser view is a child of the window being torn down, so it is closed
  // before the window rather than left holding a destroyed parent.
  workspaceBrowser?.dispose();
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
  if (!holdsInstanceLock) return;
  let options;
  try {
    // A sign-in link handed over by the website is not a Groundstation option.
    const argv = process.argv.slice(app.isPackaged ? 1 : 2).filter(argument => !isDeepLink(argument, "outarch"));
    options = parseGroundstationArgs(argv);
  } catch (error) {
    dialog.showErrorBox("OUTARCH could not start", error.message);
    app.quit();
    return;
  }

  // The account comes first: nothing below opens a project or starts a
  // terminal until the operator is signed in.
  cloud = cloudConfig();
  const supabase = new SupabaseRest({ url: cloud.supabaseUrl, key: cloud.publishableKey });
  accountService = new AccountService({
    rest: supabase,
    store: new AccountSessionStore(path.join(app.getPath("userData"), "account-session.json"), { safeStorage }),
    config: cloud,
    openExternal: url => shell.openExternal(url)
  });
  let lastBuiltinProviders = "";
  accountService.on("change", status => {
    sendToWindows("mission-control:account-event", status);
    applyPlanToServices();
    // Signing in makes the built-in models reachable; read them once it does.
    // A memory key added or removed on the server changes project memory's models.
    const providers = `${(status.builtinAiProviders || []).join(",")}|${(status.builtinMemoryProviders || []).join(",")}`;
    if (status.authorized && providers !== lastBuiltinProviders) void aiAssistant?.refreshMissionModels({ force: true }).catch(() => {});
    lastBuiltinProviders = providers;
  });
  // A signed-out app shows only the sign-in screen: pop-outs go back first.
  accountService.on("signed-out", () => { void Promise.resolve(terminalWindowManager?.recallAll()).catch(() => {}); });
  const managedAiFetch = createManagedAiFetch({ account: accountService, rest: supabase });
  updateService = new UpdateService({
    rest: supabase,
    currentVersion: APP_VERSION,
    publicKey: UPDATE_PUBLIC_KEY,
    appRoot: path.resolve(__dirname, "../../.."),
    workDir: path.join(app.getPath("userData"), "updates"),
    // The Store installs its own updates; this copy must never replace itself.
    managedBy: DISTRIBUTION.store ? STORE_DISTRIBUTION : null
  });
  updateService.on("change", status => sendToWindows("mission-control:update-event", status));
  updateService.on("available", status => {
    notificationCenter?.publish({
      kind: "update.available",
      title: `OUTARCH ${status.available?.version || "update"} is available`,
      body: status.canInstall ? "Update now to restart into the new version. Your terminals are stopped cleanly first." : (status.installBlockedReason || "A new version is ready."),
      actions: status.canInstall ? [{ id: "install-update", label: "Update now" }] : [],
      dedupeKey: `update:${status.available?.version || ""}`
    });
  });
  ipcMain.handle("mission-control:account", async (event, request) => {
    assertTrustedAppFrame(event);
    const action = typeof request?.action === "string" ? request.action : "";
    switch (action) {
      case "status": return accountService.status();
      case "signIn": await accountService.beginSignIn({ mode: request.mode === "signup" ? "signup" : "signin" }); return accountService.status();
      case "cancelSignIn": return accountService.cancelSignIn();
      case "signOut": return accountService.signOut();
      case "refresh": return accountService.refresh();
      case "openPortal": await accountService.openPortal(request.page === "pricing" ? "pricing" : "account", request.query && typeof request.query === "object" ? request.query : {}); return true;
      default: throw new Error("Unknown account request");
    }
  });
  // The terms this Windows user agreed to, with the version and the time. The
  // renderer owns the policy text and its version; this only keeps the record.
  const legalAcceptance = new LegalAcceptanceStore(path.join(app.getPath("userData"), "legal-acceptance.json"), { appVersion: APP_VERSION });
  ipcMain.handle("mission-control:legal", async (event, request) => {
    assertTrustedMainFrame(event);
    const action = typeof request?.action === "string" ? request.action : "";
    switch (action) {
      case "status": return legalAcceptance.status();
      case "accept": return legalAcceptance.accept({ version: request.version, documents: request.documents });
      default: throw new Error("Unknown legal request");
    }
  });
  ipcMain.handle("mission-control:update", async (event, request) => {
    assertTrustedMainFrame(event);
    const action = typeof request?.action === "string" ? request.action : "";
    switch (action) {
      case "status": return updateService.status();
      case "check": return updateService.check();
      case "download": return updateService.download();
      case "install": {
        await updateService.install({ quit: () => shutdownAndClose(mainWindow) });
        return updateService.status();
      }
      default: throw new Error("Unknown update request");
    }
  });
  registerDeepLinkProtocol();

  engineHost = new EngineHost({
    engineOptions: {
      // Every way a terminal can start passes here: the plan caps how many run at once.
      spawnGuard: ({ running }) => accountService.entitlements().checkRunTerminal(running)?.message || null
    }
  });
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
    credentialStore: new BuiltinMissionAiCredentials({
      preferencesPath: path.join(app.getPath("userData"), "mission-ai-preferences.json"),
      // The keys are on OUTARCH's server; which providers it has keys for,
      // for Mission AI and, separately, for arch_memory.md.
      managed: {
        providers: () => (accountService.isAuthorized() ? accountService.status().builtinAiProviders : []),
        memoryProviders: () => (accountService.isAuthorized() ? accountService.status().builtinMemoryProviders || [] : [])
      }
    }),
    fetch: (url, init) => managedAiFetch(url, init, { surface: "mission" }),
    missionContext,
    projectSupervision
  });
  missionSupervisor = new MissionSupervisorService({
    missionAi,
    getEngineApi: () => engineHost?.engineApi || null
  });
  mcpGateway = new SecureMcpGateway({
    accessLevel: () => accountService.entitlements().mcpLevel(),
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
    isAllowed: () => accountService.entitlements().limits.mobileCompanion === true,
    store: new MobileCompanionStore(
      path.join(app.getPath("userData"), "mobile-companion-credentials.json"),
      { safeStorage }
    ),
    missionContext,
    getEngineApi: () => engineHost?.engineApi || null,
    // Read-only: the assistant's ask() offers the model no action tools.
    askAssistant: request => aiAssistant ? aiAssistant.ask(request) : Promise.reject(new Error("Mission AI is not available on the desktop"))
  });
  ipcMain.handle("mission-control:open-external", async (event, url) => {
    assertTrustedMainFrame(event);
    const allowed = new Set(["https://github.com/radix-ui/primitives", "https://github.com/pacocoursey/cmdk"]);
    if (!allowed.has(url)) throw new Error("External resource is not allow-listed");
    await shell.openExternal(url);
    return true;
  });
  // Accepts a mode ("standard" | "focus") or { mode, color }. Whatever is not
  // given keeps its last value, so a colour update never undoes focus mode.
  ipcMain.handle("mission-control:set-window-chrome", async (event, request) => {
    assertTrustedMainFrame(event);
    const input = typeof request === "string" ? { mode: request } : request && typeof request === "object" ? request : null;
    if (!input) throw new TypeError("window chrome must be a mode or { mode, color }");
    const mode = input.mode === undefined ? windowChrome.mode : input.mode;
    if (mode !== "standard" && mode !== "focus") throw new TypeError("window chrome mode must be \"standard\" or \"focus\"");
    const color = input.color === undefined ? windowChrome.color : input.color;
    if (typeof color !== "string" || !WINDOW_CHROME_COLOR.test(color)) throw new TypeError("window chrome color must be #rrggbb");
    windowChrome = { mode, color };
    if (!mainWindow || mainWindow.isDestroyed() || typeof mainWindow.setTitleBarOverlay !== "function") return false;
    try {
      mainWindow.setTitleBarOverlay({ ...MAIN_TITLE_BAR_OVERLAY, color, height: mode === "focus" ? FOCUS_TITLE_BAR_HEIGHT : MAIN_TITLE_BAR_OVERLAY.height });
    } catch {
      // Platforms without an overlay (macOS draws its own traffic lights) have
      // nothing to resize; the renderer's reserved strip resolves to zero there.
      return false;
    }
    return true;
  });
  // The page clipboard refuses while the window is unfocused, which is when a
  // notification's Copy action runs; the main process has no such limit.
  ipcMain.handle("mission-control:copy-text", async (event, text) => {
    assertTrustedAppFrame(event);
    if (typeof text !== "string") throw new TypeError("copied text must be a string");
    if (text.length > MAX_COPY_CHARACTERS) throw new RangeError("That is too much text to copy at once");
    clipboard.writeText(text);
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
        title: "Open a project in OUTARCH",
        buttonLabel: "Choose project",
        properties: ["openDirectory", "createDirectory"]
      };
      const result = mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      return result.canceled ? null : result.filePaths[0] || null;
    }
  });
  // The account gate. A saved session is confirmed with Supabase first; without
  // one the window opens on the sign-in screen and the rest of startup waits
  // here until the website hands a session back.
  const visualCapture = Boolean(process.env.MISSION_CONTROL_VISUAL_CAPTURE_DIR);
  let rendererLoaded = false;
  await accountService.restore();
  if (launchDeepLink) await accountService.handleDeepLink(launchDeepLink);
  if (!accountService.isAuthorized() && !visualCapture) {
    mainWindow = createWindow({ load: false });
    mainWindow.on("focus", () => accountService?.noteWindowFocus());
    rendererLoaded = true;
    void beginRendererLoad(mainWindow);
    // Another OUTARCH (one started with --config) may receive the website's
    // link and save the session; pick it up from disk too.
    const fromDisk = setInterval(() => { void accountService?.reloadFromDisk().catch(() => {}); }, 3000);
    fromDisk.unref?.();
    const authorized = await accountService.whenAuthorized();
    clearInterval(fromDisk);
    if (!authorized || shutdownInProgress || shutdownComplete) return;
  }
  updateService.start();

  try {
    const startupOptions = projectCoordinator.resolveStartupOptions(options);
    // The gate. The journal is read before the engine opens, because opening it
    // is what spawns every autoStart worker — a recovery screen shown after
    // that point would arrive too late to prevent the relaunch it is asking
    // about. The id matches the one the rest of the app uses post-open, so both
    // read the same journal file.
    let deferAutoStart = false;
    try {
      const gateProjectId = projectIdFor(startupOptions.configPath);
      const gate = new SessionRecoveryService(new SessionJournal());
      recoveryReport = gate.inspect(gateProjectId, []);
      deferAutoStart = recoveryReport?.recoveryRequired === true;
    } catch {
      // An unreadable journal must never stop the app from starting; it just
      // means this boot proceeds normally with no recovery prompt.
      recoveryReport = null;
    }
    await engineHost.open({ ...startupOptions, deferAutoStart });
    try {
      projectCoordinator.rememberCurrent();
    } catch (registryError) {
      projectCoordinator.lastWarning = registryError instanceof Error
        ? registryError.message
        : String(registryError);
    }
  } catch (error) {
    dialog.showErrorBox("OUTARCH could not open the workspace", error.message);
    app.quit();
    return;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow({ load: false });
    mainWindow.on("focus", () => accountService?.noteWindowFocus());
  }
  // Toasts are headed with the app's registered name and logo.
  if (!process.env.MISSION_CONTROL_VISUAL_CAPTURE_DIR && !DISTRIBUTION.store) void registerWindowsAppIdentity({ execFile, iconPath: BRAND_ASSETS.iconPng256 });
  // T033/T036 — the notifier is main-process because only the main process owns
  // the OS notification surface and the window a click has to bring forward.
  const focusMainWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };
  // One notification center decides every surface: the in-app toast, the
  // Windows toast (only when OUTARCH is not the window in use), the
  // sound, and whether two signals are really one incident.
  notificationCenter = new NotificationCenter({
    Notification,
    platform: process.platform,
    isAppFocused: () => Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused()),
    getPreferences: () => engineHost?.engineApi?.getAttentionPreferences?.() || null,
    getProjectName: () => engineHost?.engineApi?.getWorkspace?.()?.name || null,
    // The taskbar button flashes for a failure you have not seen yet, and stops
    // as soon as the window is focused. It never steals focus.
    flashWindow: () => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) mainWindow.flashFrame(true);
    },
    // A click on a Windows toast. Opening a service happens here, because the
    // embedded browser lives in this process; everything else is a deep link
    // the renderer follows. The address is re-resolved at click time, so a
    // toast that sat in the action centre across a restart cannot open a
    // stale port.
    onActivate: payload => {
      focusMainWindow();
      const serviceId = payload?.notice?.data?.serviceId;
      if (payload?.actionId !== "open-service" || !serviceId) return;
      const current = workspaceIntelligence?.services.getService(serviceId);
      if (!current || current.state === "stale") {
        ipcHost?.broadcast({ type: "services:changed", detail: "stale-activation" });
        return;
      }
      try {
        workspaceBrowser?.open({ url: current.url });
      } catch {
        void shell.openExternal(current.url);
      }
    }
  });
  notificationCenter.on("notification", notification => ipcHost?.broadcast({ type: "notification:new", notification }));
  mainWindow.on("focus", () => {
    try { mainWindow.flashFrame(false); } catch { /* the window may be closing */ }
  });

  // T033/T036 — attention records (a worker that failed, printed an error or
  // needs a decision) are found here and handed to the center.
  notifications = new NotificationService({
    Notification,
    getEngineApi: () => engineHost?.engineApi || null,
    focusWindow: focusMainWindow,
    publish: record => {
      const engineApi = engineHost?.engineApi;
      let snapshot = null;
      try { snapshot = engineApi?.getSnapshot?.(record.sessionId) || null; } catch { snapshot = null; }
      const notice = fromAttentionRecord(record, snapshot);
      if (notice) notificationCenter.publish({ ...notice, projectId: currentProjectId() });
    }
  });
  notifications.start();
  bindIncidentMemory();
  // T026 — read-only port-owner inspection. It is given the engine only so it
  // can prove ownership; it has no path that terminates anything.
  portInspector = new PortInspector({ getEngineApi: () => engineHost?.engineApi || null });

  workspaceIntelligence = new WorkspaceIntelligence({
    onChange: message => ipcHost?.broadcast(message)
  });
  // One route from event to desktop. The intelligence layer already broadcasts
  // the event to every renderer; this is the single place that turns it into an
  // OS notification, so three pop-outs cannot each raise their own copy.
  workspaceIntelligence.events.on("event", event => {
    const notice = fromSemanticEvent(event);
    if (notice) notificationCenter.publish(notice);
  });
  // The same event also reaches the renderers, which is what lets a service
  // coming up, a build failing or an agent finishing a turn be an in-app
  // notification with the action on it. Without this the operational events
  // existed only as OS toasts and as rows in a panel: an operator watching the
  // app never learned that the frontend they just restarted was serving.
  workspaceIntelligence.events.on("event", event => ipcHost?.broadcast({ type: "workspace:event", event }));
  workspaceIntelligence.beginSession(currentProjectId());
  workspaceIntelligence.attachEngine(engineHost.engineApi, currentProjectId());
  terminalWindowManager = new TerminalWindowManager({
    createWindow: createDetachedTerminalWindow,
    // Closing a pop-out returns the terminal to its reserved pane; the main
    // window has to hear about it even though it did not initiate the recall.
    onRecalled: payload => ipcHost?.broadcast({ type: "terminal:recalled", ...payload })
  });
  terminalWindowManager.subscribe(event => ipcHost?.broadcast(event));
  // The browser view is a child of the main window's content view, so it lives
  // and dies with that window rather than being a surface of its own.
  workspaceBrowser = new WorkspaceBrowser({ getWindow: () => mainWindow });
  workspaceBrowser.subscribe(event => ipcHost?.broadcast(event));
  // Agent CLIs meter themselves; this reads the counts they leave on disk so an
  // agent terminal is not silently missing from the project total.
  cliUsageImporter = new CliUsageImporter({ ledger: workspaceIntelligence.usage });

  missionAiConversation = new MissionAIConversation({ missionAi, missionSupervisor });

  // The assistant behind Mission AI and the Workspace chat. Its spend is
  // recorded as assistant spend, which keeps it out of the project Usage panel.
  byokStore = new ByokStore(path.join(app.getPath("userData"), "ai-keys.json"), { safeStorage });
  aiAssistant = new AiAssistant({
    builtin: missionAi.credentialStore,
    byokStore,
    // Built-in models answer through OUTARCH's AI service, which meters the plan.
    missionFetch: managedAiFetch,
    // The operator's own keys, up to the number the plan includes.
    allowByokKey: keyId => accountService.entitlements().allowedByokKeyIds(byokStore.list()).has(keyId),
    getEngineApi: () => engineHost?.engineApi || null,
    localServiceRegistry: workspaceIntelligence.services,
    workspaceBrowser,
    preferencesPath: path.join(app.getPath("userData"), "ai-preferences.json"),
    onUsage: usage => {
      try { workspaceIntelligence.usage.record({ ...usage, surface: "assistant", projectId: currentProjectId() }); }
      catch { /* Metering never breaks an answer. */ }
    }
  });
  // Every step of a turn — a tool starting, an approval appearing, the reply
  // landing — reaches the renderers as it happens, so a long answer shows its
  // progress instead of a spinner.
  aiAssistant.on("conversation", payload => ipcHost?.broadcast({ type: "ai:conversation", ...payload }));
  aiAssistant.on("change", payload => ipcHost?.broadcast({ type: "ai:changed", ...payload }));
  aiAssistant.on("navigate", payload => ipcHost?.broadcast({ type: "notification:activate", route: payload?.route || "workspace" }));
  void migrateLegacyMissionAiKey();
  void aiAssistant.reconcileKeysOnStartup();
  projectMemory = new ProjectMemoryFile({
    getEngineApi: () => engineHost?.engineApi || null,
    missionContext,
    assistant: aiAssistant,
    preferencesPath: path.join(app.getPath("userData"), "project-memory.json"),
    // Only ever the memory file of the open project; the path is the service's own.
    openPath: memoryFile => shell.openPath(memoryFile)
  });
  projectMemory.on("change", () => ipcHost?.broadcast({ type: "projectMemory:changed" }));
  projectMemory.on("close-request", payload => ipcHost?.broadcast({ type: "projectMemory:close-requested", ...payload }));
  // Keeps the memory's facts (terminals, servers) current as the terminals change.
  projectMemory.observe(engineHost?.engineApi || null);
  // Mission AI's own Gemini calls are the one source whose token counts are
  // reported by the provider, so they are recorded rather than estimated. This
  // is the single write point: every Mission AI request passes through it,
  // whether it came from the conversation or from a direct ask/plan call, so
  // nothing is counted twice.
  // Marked as assistant spend, which is what keeps it out of the Usage panel:
  // that panel answers "what is this project costing me?", and a number that
  // moved every time the operator asked Mission AI about it could not answer
  // that. The records are still written, so the spend is auditable.
  missionAi?.onUsage?.(usage => {
    try {
      workspaceIntelligence.usage.record({ ...usage, surface: "assistant", projectId: currentProjectId() });
    } catch {
      // Metering must never break the answer the user asked for.
    }
  });

  ipcHost = new GroundstationIpcHost({
    ipcMain,
    getEngineApi: () => engineHost.engineApi,
    createProtocolConnection,
    localServiceRegistry: workspaceIntelligence.services,
    usageLedger: workspaceIntelligence.usage,
    agentActivityService: workspaceIntelligence.agents,
    semanticEventRouter: workspaceIntelligence.events,
    sessionRecoveryService: workspaceIntelligence.recovery,
    terminalWindowManager,
    missionAiConversation,
    aiAssistant,
    projectMemory,
    // Write authority is decided in the main process. A renderer that lost the
    // handoff, or a pop-out for a different worker, is refused at the protocol
    // rather than being trusted to stop sending keystrokes.
    terminalLeases: terminalWindowManager.leases,
    // The gate's findings and the one action that ends the deferral it caused.
    importCliUsage: async () => {
      const workspace = engineHost?.engineApi?.getWorkspace?.();
      const summary = cliUsageImporter.import({
        projectId: currentProjectId(),
        projectPath: workspace?.directory || workspace?.path || null
      });
      if (summary.recordsImported) ipcHost?.broadcast({ type: "usage:changed" });
      return summary;
    },
    recoveryBoot: {
      getReport: () => recoveryReport,
      isDeferred: () => engineHost?.engineApi?.autoStartDeferred === true,
      resume: async () => {
        const started = engineHost?.engineApi?.releaseAutoStart?.() || [];
        if (started.length) ipcHost?.broadcast({ type: "services:changed", detail: "recovery:resumed" });
        return started;
      }
    },
    workspaceBrowser,
    resolveViewId: webContentsId => terminalWindowManager.viewIdForWebContents(webContentsId),
    onProjectSwitched: rebindWorkspaceIntelligence,
    // The protocol already resolved the service id and proved the address is a
    // loopback HTTP(S) URL with no credentials; this only performs the open.
    openServiceUrl: async url => { await shell.openExternal(url); },
    onShutdown: () => shutdownAndClose(mainWindow),
    projectService: projectCoordinator,
    recoveryService,
    vscodeBridge,
    missionAi,
    missionSupervisor,
    projectSupervision,
    mcpGateway,
    mobileCompanion,
    notifications: notificationCenter,
    portInspector,
    planGate: { entitlements: () => accountService.entitlements() },
    // A keystroke into a terminal answers what its agent was asking.
    onTerminalInput: workerId => workspaceIntelligence?.noteInput(workerId)
  });
  ipcHost.bind();
  try { await mcpGateway.start(); }
  catch (error) { mcpGateway.lastError = error instanceof Error ? error.message : String(error); }
  try { await mobileCompanion.start(); }
  catch (error) { mobileCompanion.lastError = error instanceof Error ? error.message : String(error); }
  // An answered permission question takes its notification back, so the
  // agent's next question notifies again.
  workspaceIntelligence.prompts.on("cleared", ({ workerId }) => {
    try { notificationCenter?.withdrawKind(workerId, "agent.awaitingApproval"); } catch { /* best effort */ }
  });
  accountService.setEngineReady(true);
  applyPlanToServices();
  // Signed in at launch: load the app. Signed in from the sign-in screen: the
  // renderer is already up and mounts the app when it hears engineReady.
  if (!rendererLoaded) void beginRendererLoad(mainWindow);
}

app.whenReady().then(start).catch(async error => {
  recoveryService?.mainFailed("startup-failure");
  missionAi?.dispose();
  aiAssistant?.dispose();
  await mcpGateway?.dispose();
  await mobileCompanion?.dispose();
  vscodeBridge?.dispose();
  try {
    await engineHost?.shutdown();
  } catch (shutdownError) {
    // Startup reporting must still complete if cleanup itself throws.
  }
  dialog.showErrorBox("OUTARCH crashed during startup", error.message);
  app.quit();
});

// A second launch lands here: bring the window that is already open forward.
app.on("second-instance", (_event, argv = []) => {
  // The website handing a sign-in back arrives as a second launch.
  const link = Array.isArray(argv) ? argv.find(argument => isDeepLink(argument, "outarch")) : null;
  if (link) void accountService?.handleDeepLink(link);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
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
