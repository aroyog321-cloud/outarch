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
  #pluginPlatform;
  #notifications;
  #portInspector;
  #connections;
  #observedWebContents;
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
    this.#pluginPlatform = options.pluginPlatform || null;
    this.#notifications = options.notifications || null;
    this.#portInspector = options.portInspector || null;
    this.#connections = new Map();
    this.#observedWebContents = new Set();
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
      pluginPlatform: this.#pluginPlatform,
      notifications: this.#notifications,
      portInspector: this.#portInspector
    });
    this.#connections.set(webContents.id, connection);
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

  disposeConnection(webContentsId) {
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
  }
}

module.exports = {
  EVENT_CHANNEL,
  GroundstationIpcHost,
  REQUEST_CHANNEL
};
