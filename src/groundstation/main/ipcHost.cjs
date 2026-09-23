const REQUEST_CHANNEL = "mission-control:request";
const EVENT_CHANNEL = "mission-control:event";

class GroundstationIpcHost {
  #ipcMain;
  #getEngineApi;
  #createProtocolConnection;
  #onShutdown;
  #projectService;
  #recoveryService;
  #vscodeBridge;
  #missionAi;
  #missionSupervisor;
  #projectSupervision;
  #mcpGateway;
  #mobileCompanion;
  #notifications;
  #portInspector;
  #localServiceRegistry;
  #usageLedger;
  #terminalWindowManager;
  #workspaceBrowser;
  #sessionRecoveryService;
  #missionAiConversation;
  #aiAssistant;
  #projectMemory;
  #agentActivityService;
  #semanticEventRouter;
  #onProjectSwitched;
  #openServiceUrl;
  #terminalLeases;
  #resolveViewId;
  #recoveryBoot;
  #importCliUsage;
  #planGate;
  #onTerminalInput;
  #connections;
  #observedWebContents;
  #trackedWebContents;
  #bound;

  constructor(options) {
    this.#ipcMain = options.ipcMain;
    this.#getEngineApi = typeof options.getEngineApi === "function"
      ? options.getEngineApi
      : () => options.engineApi;
    this.#createProtocolConnection = options.createProtocolConnection;
    this.#onShutdown = options.onShutdown;
    this.#projectService = options.projectService || null;
    this.#recoveryService = options.recoveryService || null;
    this.#vscodeBridge = options.vscodeBridge || null;
    this.#missionAi = options.missionAi || null;
    this.#missionSupervisor = options.missionSupervisor || null;
    this.#projectSupervision = options.projectSupervision || null;
    this.#mcpGateway = options.mcpGateway || null;
    this.#mobileCompanion = options.mobileCompanion || null;
    this.#notifications = options.notifications || null;
    this.#portInspector = options.portInspector || null;
    this.#localServiceRegistry = options.localServiceRegistry || null;
    this.#usageLedger = options.usageLedger || null;
    this.#terminalWindowManager = options.terminalWindowManager || null;
    this.#workspaceBrowser = options.workspaceBrowser || null;
    this.#sessionRecoveryService = options.sessionRecoveryService || null;
    this.#missionAiConversation = options.missionAiConversation || null;
    this.#aiAssistant = options.aiAssistant || null;
    this.#projectMemory = options.projectMemory || null;
    this.#agentActivityService = options.agentActivityService || null;
    this.#semanticEventRouter = options.semanticEventRouter || null;
    this.#onProjectSwitched = typeof options.onProjectSwitched === "function" ? options.onProjectSwitched : null;
    this.#openServiceUrl = typeof options.openServiceUrl === "function" ? options.openServiceUrl : null;
    this.#terminalLeases = options.terminalLeases || null;
    // Which presentation view a renderer speaks for. The main window is the
    // default; a pop-out is registered by the main process when it is created.
    this.#resolveViewId = typeof options.resolveViewId === "function" ? options.resolveViewId : null;
    this.#recoveryBoot = options.recoveryBoot || null;
    this.#importCliUsage = typeof options.importCliUsage === "function" ? options.importCliUsage : null;
    this.#planGate = options.planGate || null;
    this.#onTerminalInput = typeof options.onTerminalInput === "function" ? options.onTerminalInput : null;
    this.#connections = new Map();
    this.#observedWebContents = new Set();
    this.#trackedWebContents = new Map();
    this.#bound = false;
  }

  bind() {
    if (this.#bound) return;
    this.#bound = true;
    this.#ipcMain.handle(REQUEST_CHANNEL, async (event, request) => {
      if (event.senderFrame && event.senderFrame !== event.sender.mainFrame) {
        return {
          version: 1,
          id: request?.id || null,
          ok: false,
          error: { code: "FORBIDDEN_FRAME", message: "requests are accepted only from the main frame" }
        };
      }
      const response = await this.#connectionFor(event.sender).handle(request);
      if (
        response?.ok === true &&
        response?.result?.changed !== false &&
        (request?.method === "project.open" || request?.method === "project.initialize")
      ) {
        // Project switching replaces the EngineAPI instance. Dispose every
        // renderer connection only after the initiating response is complete;
        // the next state.get binds to the new engine and terminal epoch.
        this.disposeConnections();
        // Observers of the old engine (service discovery, agent activity) have
        // to be re-pointed at the new one, or they keep describing the workers
        // of the project that was just closed.
        try { await this.#onProjectSwitched?.(); } catch {}
      }
      return response;
    });
  }

  #connectionFor(webContents) {
    let connection = this.#connections.get(webContents.id);
    if (connection) return connection;

    const engineApi = this.#getEngineApi();
    if (!engineApi) throw new Error("Groundstation engine is unavailable");
    connection = this.#createProtocolConnection(engineApi, {
      send: message => {
        // invoke() carries request responses. The event channel is reserved
        // for unsolicited engine/terminal notifications so renderers never
        // observe the same response twice.
        if (message?.type && !webContents.isDestroyed()) {
          webContents.send(EVENT_CHANNEL, message);
        }
      },
      onShutdown: this.#onShutdown,
      projectService: this.#projectService,
      recoveryService: this.#recoveryService,
      vscodeBridge: this.#vscodeBridge,
      missionAi: this.#missionAi,
      missionSupervisor: this.#missionSupervisor,
      projectSupervision: this.#projectSupervision,
      mcpGateway: this.#mcpGateway,
      mobileCompanion: this.#mobileCompanion,
      notifications: this.#notifications,
      portInspector: this.#portInspector,
      localServiceRegistry: this.#localServiceRegistry,
      usageLedger: this.#usageLedger,
      terminalWindowManager: this.#terminalWindowManager,
      workspaceBrowser: this.#workspaceBrowser,
      sessionRecoveryService: this.#sessionRecoveryService,
      missionAiConversation: this.#missionAiConversation,
      aiAssistant: this.#aiAssistant,
      projectMemory: this.#projectMemory,
      agentActivityService: this.#agentActivityService,
      semanticEventRouter: this.#semanticEventRouter,
      openServiceUrl: this.#openServiceUrl,
      terminalLeases: this.#terminalLeases,
      recoveryBoot: this.#recoveryBoot,
      importCliUsage: this.#importCliUsage,
      planGate: this.#planGate,
      onTerminalInput: this.#onTerminalInput,
      getViewId: () => this.#resolveViewId?.(webContents.id) || "main"
    });
    this.#connections.set(webContents.id, connection);
    this.#trackedWebContents.set(webContents.id, webContents);
    if (!this.#observedWebContents.has(webContents.id)) {
      this.#observedWebContents.add(webContents.id);
      webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) this.disposeConnection(webContents.id);
      });
      webContents.on("render-process-gone", () => this.disposeConnection(webContents.id));
      webContents.once("destroyed", () => {
        this.disposeConnection(webContents.id);
        this.#observedWebContents.delete(webContents.id);
      });
    }
    return connection;
  }

  // Unsolicited operational updates (service discovery, usage, pop-out state)
  // reach every live renderer here rather than being polled. The event channel
  // already carries engine notifications, so renderers observe one stream.
  broadcast(message) {
    if (!message || typeof message.type !== "string") return 0;
    const envelope = { version: 1, ...message };
    let delivered = 0;
    for (const [id, webContents] of this.#trackedWebContents) {
      if (!webContents || webContents.isDestroyed()) {
        this.#trackedWebContents.delete(id);
        continue;
      }
      try {
        webContents.send(EVENT_CHANNEL, envelope);
        delivered += 1;
      } catch {
        // A destroyed or navigating renderer must not stop the others.
      }
    }
    return delivered;
  }

  disposeConnection(webContentsId) {
    this.#trackedWebContents.delete(webContentsId);
    const connection = this.#connections.get(webContentsId);
    if (!connection) return false;
    this.#connections.delete(webContentsId);
    connection.dispose();
    return true;
  }

  disposeConnections() {
    if (!this.#connections.size) return false;
    for (const connection of this.#connections.values()) connection.dispose();
    this.#connections.clear();
    return true;
  }

  dispose() {
    if (this.#bound) this.#ipcMain.removeHandler(REQUEST_CHANNEL);
    this.#bound = false;
    this.disposeConnections();
    this.#observedWebContents.clear();
    this.#trackedWebContents.clear();
  }
}

module.exports = {
  EVENT_CHANNEL,
  GroundstationIpcHost,
  REQUEST_CHANNEL
};
