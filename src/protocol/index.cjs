const crypto = require("node:crypto");
const { CommandRouter } = require("../engine/commandRouter.cjs");
const { buildDecisionQuery, parseDecisionId, CONFIRMED_SOURCES } = require("./decisionBroker.cjs");
const { buildHistoryModel, exportHistory } = require("./historyExport.cjs");
const { createAgentDefinition, listAgentAdapters } = require("../service/agentAdapters.cjs");
const { MissionContextService } = require("../service/missionContext.cjs");
const { planBroadcast, MAX_BROADCAST_TARGETS } = require("../service/broadcastGuard.cjs");
const { describePortOwner } = require("../service/portOwnership.cjs");
const { ProjectSupervisionService } = require("../service/projectSupervision.cjs");

const PROTOCOL_VERSION = 1;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_TERMINAL_INPUT_BYTES = 64 * 1024;
const MAX_TERMINAL_REPLAY_BYTES = 1024 * 1024;
const MAX_TERMINAL_QUEUE_BYTES = 1024 * 1024;
const MAX_TERMINAL_BATCH_BYTES = 64 * 1024;
const MAX_EVENT_QUEUE = 1000;
const MAX_TERMINAL_DIMENSION = 1000;
const MAX_OPEN_TERMINALS = 64;
const CAPABILITY_STATES = Object.freeze(["unavailable", "disabled", "loading", "error", "ready"]);
const CONFIRMATION_TTL_MS = 60 * 1000;
const MAX_PENDING_CONFIRMATIONS = 128;
const CONFIRMATION_METHODS = new Set([
  "terminal.broadcast",
  "missionAi.clear",
  "ai.byok.remove",
  "missionSupervisor.approval.resolve",
  "vscode.terminal.create",
  "vscode.terminal.write",
  "vscode.terminal.close",
  "mcp.rotateToken",
  "mcp.approval.resolve",
  "mobile.invite",
  "mobile.device.revoke",
  "mobile.approval.resolve",
  "recipe.delete",
  "automation.delete",
  "automation.approval.resolve",
  "mission.transition",
  "mission.checkpoint.verify",
  "mission.approval.resolve",
  "decisions.resolve",
  "project.open",
  "project.initialize",
  "action.dispatch"
]);

const METHODS = Object.freeze([
  "system.hello",
  "confirmation.request",
  "system.recovery.get",
  "state.get",
  "events.activate",
  "activity.get",
  "memory.summary",
  "history.model",
  "history.export",
  "context.snapshot",
  "supervision.get",
  "missionAi.status",
  "missionAi.configure",
  "missionAi.ask",
  "missionAi.clear",
  "missionAi.audit.list",
  "missionSupervisor.status",
  "missionSupervisor.plan",
  "missionSupervisor.approval.list",
  "missionSupervisor.approval.resolve",
  "workspace.get",
  "integration.list",
  "vscode.status",
  "vscode.launch",
  "vscode.openFile",
  "vscode.openProblems",
  "vscode.terminal.create",
  "vscode.terminal.write",
  "vscode.terminal.focus",
  "vscode.terminal.close",
  "vscode.disconnect",
  "vscode.audit.list",
  "mcp.status",
  "mcp.getToken",
  "mcp.configure",
  "mcp.rotateToken",
  "mcp.installClient",
  "mcp.removeClient",
  "mcp.uninstallClient",
  "mcp.clientStatus",
  "mcp.tools.list",
  "mcp.tool.call",
  "mcp.approval.list",
  "mcp.approval.resolve",
  "mcp.audit.list",
  "mobile.status",
  "mobile.configure",
  "mobile.invite",
  "mobile.device.list",
  "mobile.device.revoke",
  "mobile.approval.list",
  "mobile.approval.resolve",
  "mobile.audit.list",
  "recipe.list",
  "recipe.save",
  "recipe.delete",
  "recipe.run",
  "recipe.pause",
  "recipe.resume",
  "recipe.cancel",
  "automation.list",
  "automation.save",
  "automation.delete",
  "automation.test",
  "automation.approval.resolve",
  "automation.audit.list",
  "session.get",
  "session.configuration.get",
  "preset.list",
  "agents.list",
  "agent.create",
  "mission.list",
  "mission.save",
  "mission.instruction.record",
  "mission.transition",
  "mission.checkpoint.verify",
  "mission.approval.list",
  "mission.approval.request",
  "mission.approval.resolve",
  "attention.list",
  "notification.status",
  "notification.test",
  "attention.transition",
  "attention.preferences.save",
  "decisions.list",
  "decisions.acknowledge",
  "decisions.resolve",
  "projects.list",
  "project.choose",
  "project.open",
  "project.initialize",
  "project.removeRecent",
  "action.dispatch",
  "terminal.open",
  "terminal.activate",
  "terminal.write",
  "terminal.broadcast.preview",
  "terminal.broadcast",
  "crashlens.port.inspect",
  "terminal.resize",
  "terminal.close",
  "services.list",
  "services.open",
  "services.copy",
  "services.owner",
  "services.inspectPort",
  "usage.query",
  "usage.import",
  "terminal.window.list",
  "terminal.window.detach",
  "terminal.window.recall",
  "terminal.window.focus",
  "workspace.browser.open",
  "workspace.browser.bounds",
  "workspace.browser.command",
  "workspace.browser.state",
  "recovery.inspect",
  "recovery.propose",
  "recovery.resume",
  "agents.activity",
  "missionAi.conversation.send",
  "missionAi.conversation.history",
  "ai.status",
  "ai.selection.set",
  "ai.byok.detect",
  "ai.byok.add",
  "ai.byok.remove",
  "ai.byok.refresh",
  "ai.chat.send",
  "ai.chat.resolve",
  "ai.chat.history",
  "ai.chat.clear",
  "ai.chat.cancel",
  "ai.chat.autoApprove",
  "system.shutdown"
]);

class ProtocolError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    // A plan refusal says which plan would allow the request, so the renderer
    // can offer the upgrade instead of a bare error.
    this.details = details && typeof details === "object" ? details : null;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stableConfirmationValue(value) {
  if (Array.isArray(value)) return value.map(stableConfirmationValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableConfirmationValue(value[key])]));
  }
  return value;
}

function confirmationBinding(method, params) {
  const boundedParams = { ...params };
  delete boundedParams.confirmation;
  return crypto.createHash("sha256").update(JSON.stringify([method, stableConfirmationValue(boundedParams)]), "utf8").digest("hex");
}

function byteLength(value) {
  return Buffer.byteLength(String(value), "utf8");
}

function splitUtf8(value, maxBytes) {
  const text = String(value);
  if (byteLength(text) <= maxBytes) return text ? [text] : [];

  const encoded = Buffer.from(text, "utf8");
  const chunks = [];
  let offset = 0;
  while (offset < encoded.length) {
    let end = Math.min(offset + maxBytes, encoded.length);
    if (end < encoded.length) {
      // Move a boundary at most three bytes so a chunk never begins in the
      // middle of a UTF-8 sequence. This keeps large output bursts linear in
      // the number of batches instead of iterating every JavaScript character.
      while (end > offset && (encoded[end] & 0xc0) === 0x80) end--;
    }
    if (end === offset) end = Math.min(offset + maxBytes, encoded.length);
    chunks.push(encoded.subarray(offset, end).toString("utf8"));
    offset = end;
  }
  return chunks;
}

class BoundedOutputQueue {
  constructor(maxBytes = MAX_TERMINAL_QUEUE_BYTES) {
    this.maxBytes = maxBytes;
    this.chunks = [];
    this.bytes = 0;
    this.droppedBytes = 0;
  }

  append(data, sequence = null) {
    for (const chunk of splitUtf8(data, MAX_TERMINAL_BATCH_BYTES)) {
      const bytes = byteLength(chunk);
      this.chunks.push({
        data: chunk,
        bytes,
        sequence: Number.isInteger(sequence) && sequence >= 0 ? sequence : null
      });
      this.bytes += bytes;
    }
    while (this.bytes > this.maxBytes && this.chunks.length) {
      const removed = this.chunks.shift();
      this.bytes -= removed.bytes;
      this.droppedBytes += removed.bytes;
    }
  }

  clear() {
    this.chunks = [];
    this.bytes = 0;
    this.droppedBytes = 0;
  }

  discardThrough(sequence) {
    if (!Number.isInteger(sequence) || sequence < 0) return false;
    const retained = [];
    let retainedBytes = 0;
    for (const chunk of this.chunks) {
      if (chunk.sequence !== null && chunk.sequence <= sequence) continue;
      retained.push(chunk);
      retainedBytes += chunk.bytes;
    }
    this.chunks = retained;
    this.bytes = retainedBytes;
    return true;
  }

  drainBatch() {
    if (!this.chunks.length) return null;
    const selected = [];
    let selectedBytes = 0;
    while (this.chunks.length) {
      const next = this.chunks[0];
      if (selected.length && selectedBytes + next.bytes > MAX_TERMINAL_BATCH_BYTES) break;
      this.chunks.shift();
      this.bytes -= next.bytes;
      selected.push(next.data);
      selectedBytes += next.bytes;
    }
    const droppedBytes = this.droppedBytes;
    this.droppedBytes = 0;
    return { data: selected.join(""), droppedBytes };
  }
}

function requestIdFrom(value) {
  return isPlainObject(value) && typeof value.id === "string" ? value.id : null;
}

function decodeRequest(input) {
  let value = input;
  let encodedBytes;

  if (Buffer.isBuffer(input) || typeof input === "string") {
    encodedBytes = Buffer.isBuffer(input) ? input.length : byteLength(input);
    if (encodedBytes > MAX_REQUEST_BYTES) {
      throw new ProtocolError("REQUEST_TOO_LARGE", `request cannot exceed ${MAX_REQUEST_BYTES} bytes`);
    }
    try {
      value = JSON.parse(Buffer.isBuffer(input) ? input.toString("utf8") : input);
    } catch (error) {
      throw new ProtocolError("INVALID_REQUEST", "request must contain valid JSON");
    }
  }

  if (!isPlainObject(value)) {
    throw new ProtocolError("INVALID_REQUEST", "request must be an object");
  }
  if (encodedBytes === undefined) {
    try {
      encodedBytes = byteLength(JSON.stringify(value));
    } catch (error) {
      throw new ProtocolError("INVALID_REQUEST", "request must be JSON-serializable");
    }
    if (encodedBytes > MAX_REQUEST_BYTES) {
      throw new ProtocolError("REQUEST_TOO_LARGE", `request cannot exceed ${MAX_REQUEST_BYTES} bytes`);
    }
  }

  const unsupported = Object.keys(value).filter(key => !["version", "id", "method", "params"].includes(key));
  if (unsupported.length) {
    throw new ProtocolError("INVALID_REQUEST", `unsupported request field: ${unsupported[0]}`);
  }
  if (value.version !== PROTOCOL_VERSION) {
    throw new ProtocolError("VERSION_MISMATCH", `unsupported protocol version: ${value.version}`);
  }
  if (typeof value.id !== "string" || !value.id || value.id.length > 128) {
    throw new ProtocolError("INVALID_REQUEST", "request id must be a non-empty string of at most 128 characters");
  }
  if (typeof value.method !== "string" || !value.method || value.method.length > 128) {
    throw new ProtocolError("INVALID_REQUEST", "method must be a non-empty string");
  }
  if (!isPlainObject(value.params)) {
    throw new ProtocolError("INVALID_REQUEST", "params must be an object");
  }
  return value;
}

function requireString(params, field) {
  const value = params[field];
  if (typeof value !== "string" || !value) {
    throw new ProtocolError("INVALID_PARAMS", `${field} must be a non-empty string`);
  }
  return value;
}

// Addresses reach this registry by being printed to a terminal, so anything a
// dependency logs can end up here. Only a loopback HTTP(S) address is ever
// handed to the OS browser, and any credential or secret-bearing query the
// worker printed is dropped rather than forwarded.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "::", "[::1]", "[::]"]);

function assertOpenableServiceUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    throw new ProtocolError("INVALID_PARAMS", "That service address is not a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ProtocolError("FORBIDDEN", "Only http and https service addresses can be opened.");
  }
  if (parsed.username || parsed.password) {
    throw new ProtocolError("FORBIDDEN", "That address carries credentials and will not be opened.");
  }
  const host = parsed.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host) && !LOOPBACK_HOSTS.has(`[${host}]`)) {
    throw new ProtocolError("FORBIDDEN", "Only local addresses can be opened from OUTARCH.");
  }
  // The path is evidence the worker advertised; the query and fragment are not
  // worth the risk of carrying a token into browser history.
  return `${parsed.protocol}//${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
}

// An address the operator typed into the workspace browser is not a record a
// worker printed, so the same three refusals apply — scheme, credentials, host —
// but the query and fragment are kept. Dropping them silently would load a
// different page than the one that was asked for, which is worse than refusing.
function assertPreviewableUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    throw new ProtocolError("INVALID_PARAMS", "That is not a valid address.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ProtocolError("FORBIDDEN", "Only http and https addresses can be previewed.");
  }
  if (parsed.username || parsed.password) {
    throw new ProtocolError("FORBIDDEN", "That address carries credentials and will not be opened.");
  }
  const host = parsed.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host) && !LOOPBACK_HOSTS.has(`[${host}]`)) {
    throw new ProtocolError("FORBIDDEN", "OUTARCH previews addresses on this machine. Use your system browser for anything else.");
  }
  return parsed.toString();
}

function terminalReplay(engineApi, sessionId, rawReplay) {
  const replay = typeof rawReplay === "string" ? { data: rawReplay, complete: true } : rawReplay;
  const rawData = typeof replay?.data === "string" ? replay.data : "";
  const complete = replay?.complete !== false;
  let source = "raw";
  let data = rawData;

  if (!complete) {
    source = "snapshot";
    const snapshot = engineApi.getSnapshot(sessionId);
    data = Array.isArray(snapshot?.lines) ? snapshot.lines.join("\r\n") : "";
    if (data) data += "\r\n";
  }

  const queue = new BoundedOutputQueue(MAX_TERMINAL_REPLAY_BYTES);
  queue.append(data);
  const retained = [];
  let droppedBytes = 0;
  let batch;
  while ((batch = queue.drainBatch())) {
    retained.push(batch.data);
    droppedBytes += batch.droppedBytes;
  }
  return {
    data: retained.join(""),
    byteLength: retained.reduce((total, chunk) => total + byteLength(chunk), 0),
    complete: complete && droppedBytes === 0,
    source,
    droppedBytes,
    throughSequence: Number.isInteger(replay?.throughSequence) ? replay.throughSequence : null
  };
}

function createProtocolConnection(engineApi, options = {}) {
  if (!engineApi || typeof engineApi.subscribe !== "function") {
    throw new TypeError("createProtocolConnection requires an EngineAPI-compatible object");
  }
  if (typeof options.send !== "function") {
    throw new TypeError("createProtocolConnection requires a send function");
  }

  const router = new CommandRouter(engineApi);
  const send = options.send;
  const onShutdown = options.onShutdown;
  const projectService = options.projectService || null;
  const recoveryService = options.recoveryService || null;
  const vscodeBridge = options.vscodeBridge || null;
  const missionAi = options.missionAi || null;
  const missionSupervisor = options.missionSupervisor || null;
  const mcpGateway = options.mcpGateway || null;
  const mobileCompanion = options.mobileCompanion || null;
  const notifications = options.notifications || null;
  const portInspector = options.portInspector || null;
  const localServiceRegistry = options.localServiceRegistry || null;
  const usageLedger = options.usageLedger || null;
  const terminalWindowManager = options.terminalWindowManager || null;
  const workspaceBrowser = options.workspaceBrowser || null;
  const sessionRecoveryService = options.sessionRecoveryService || null;
  const missionAiConversation = options.missionAiConversation || null;
  // Mission AI and the Workspace chat: one assistant, any model, tool access
  // gated by operator approval inside the conversation itself.
  const aiAssistant = options.aiAssistant || null;
  const agentActivityService = options.agentActivityService || null;
  const semanticEventRouter = options.semanticEventRouter || null;
  const openServiceUrl = typeof options.openServiceUrl === "function" ? options.openServiceUrl : null;
  // The report captured before the engine opened, plus the action that ends the
  // launch deferral it caused.
  const recoveryBoot = options.recoveryBoot || null;
  // Reads local agent-CLI transcripts into the ledger. Counts only.
  const importCliUsage = typeof options.importCliUsage === "function" ? options.importCliUsage : null;
  // Which presentation view this connection speaks for, and the lease table
  // that says which view currently owns each terminal's keyboard.
  const terminalLeases = options.terminalLeases || null;
  // The operator's plan. `entitlements()` returns what it allows right now; a
  // request outside it is refused here, before any service sees it.
  const planGate = options.planGate && typeof options.planGate.entitlements === "function" ? options.planGate : null;
  // Told about every keystroke that reaches a terminal: typing into an agent's
  // terminal is how the operator answers what it was asking.
  const onTerminalInput = typeof options.onTerminalInput === "function" ? options.onTerminalInput : null;
  const viewId = typeof options.getViewId === "function" ? options.getViewId : () => "main";
  const now = options.now || Date.now;
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const missionContext = options.missionContext || new MissionContextService({
    getEngineApi: () => engineApi,
    getVSCodeStatus: () => typeof vscodeBridge?.status === "function" ? vscodeBridge.status() : null
  });
  const projectSupervision = options.projectSupervision || new ProjectSupervisionService({ missionContext });
  const agentAdapterOptions = options.agentAdapterOptions || {};
  const terminalStreams = new Map();
  let disposed = false;
  let eventMode = "queued";
  let snapshotSequence = null;
  let eventQueue = [];
  let eventDroppedThrough = 0;
  const pendingConfirmations = new Map();

  function recordConfirmation(kind, operation, outcomeCode) {
    try {
      engineApi.recordConfirmationEvent?.(kind, {
        operation,
        ...(outcomeCode ? { outcomeCode } : {})
      });
    } catch {
      // Audit persistence must not broaden protocol authority or turn an
      // otherwise valid operation into a second failure path.
    }
  }

  function confirmationIsRequired(method, params) {
    if (!CONFIRMATION_METHODS.has(method)) return false;
    if (method === "action.dispatch") return isPlainObject(params.action) && router.riskTier(params.action.type) === "destructive";
    if (method === "decisions.resolve") {
      if (typeof params.id !== "string") return false;
      try { return CONFIRMED_SOURCES.has(parseDecisionId(params.id).source); }
      catch { return false; }
    }
    return true;
  }

  function pruneConfirmations(currentTime = now()) {
    for (const [token, record] of pendingConfirmations) {
      if (record.expiresAt <= currentTime) {
        pendingConfirmations.delete(token);
        recordConfirmation("expired", record.method, "CONFIRMATION_EXPIRED");
      }
    }
    while (pendingConfirmations.size >= MAX_PENDING_CONFIRMATIONS) {
      pendingConfirmations.delete(pendingConfirmations.keys().next().value);
    }
  }

  function issueConfirmation(method, params) {
    if (typeof method !== "string" || !confirmationIsRequired(method, params)) {
      throw new ProtocolError("INVALID_PARAMS", "targetMethod must identify an operation that requires confirmation");
    }
    const issuedAt = now();
    pruneConfirmations(issuedAt);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = issuedAt + CONFIRMATION_TTL_MS;
    pendingConfirmations.set(token, { method, binding: confirmationBinding(method, params), expiresAt });
    recordConfirmation("requested", method);
    return { token, expiresAt, method, confirmationProtocolVersion: 2 };
  }

  function requireConfirmation(method, params) {
    const token = typeof params.confirmation === "string" ? params.confirmation : "";
    if (!token) {
      recordConfirmation("rejected", method, "CONFIRMATION_REQUIRED");
      throw new ProtocolError("CONFIRMATION_REQUIRED", "a server-issued confirmation token is required");
    }
    const record = pendingConfirmations.get(token);
    if (!record) {
      recordConfirmation("rejected", method, "CONFIRMATION_INVALID");
      throw new ProtocolError("CONFIRMATION_INVALID", "confirmation token is invalid or has already been used");
    }
    pendingConfirmations.delete(token);
    if (record.expiresAt <= now()) {
      recordConfirmation("expired", record.method, "CONFIRMATION_EXPIRED");
      throw new ProtocolError("CONFIRMATION_EXPIRED", "confirmation token has expired");
    }
    if (record.method !== method || record.binding !== confirmationBinding(method, params)) {
      recordConfirmation("rejected", method, "CONFIRMATION_MISMATCH");
      throw new ProtocolError("CONFIRMATION_MISMATCH", "confirmation token does not authorize this exact operation");
    }
    recordConfirmation("confirmed", method);
  }

  const methodsWithPrefix = prefix => METHODS.filter(method => method.startsWith(prefix));
  const capabilityDefinitions = [
    { id: "engine", service: engineApi, methods: ["state.get", "events.activate", "activity.get", "session.get", "session.configuration.get", "preset.list", "action.dispatch", "terminal.open", "terminal.activate", "terminal.write", "terminal.resize", "terminal.close"], state: () => "ready" },
    { id: "projects", service: projectService, methods: [...new Set([...methodsWithPrefix("project"), "projects.list"])], state: () => "ready" },
    { id: "intelligence", service: missionAi, methods: methodsWithPrefix("missionAi."), state: value => value?.available === false ? "unavailable" : value?.lastError ? "error" : value?.busy ? "loading" : value?.configured ? "ready" : "disabled" },
    { id: "mission-supervisor", service: missionSupervisor, methods: methodsWithPrefix("missionSupervisor."), state: () => "ready" },
    { id: "vscode", service: vscodeBridge, methods: methodsWithPrefix("vscode."), state: value => value?.lastError && !value?.connected ? "error" : value?.awaitingHandshake ? "loading" : value?.connected ? "ready" : "disabled" },
    { id: "mcp", service: mcpGateway, methods: methodsWithPrefix("mcp."), state: value => value?.available === false ? "unavailable" : value?.lastError ? "error" : value?.enabled && !value?.running ? "loading" : value?.running ? "ready" : "disabled" },
    { id: "automation", service: engineApi, methods: methodsWithPrefix("automation."), state: () => "ready" },
    { id: "companion", service: mobileCompanion, methods: methodsWithPrefix("mobile."), state: value => value?.available === false ? "unavailable" : value?.lastError ? "error" : value?.enabled && !value?.running ? "loading" : value?.running ? "ready" : "disabled" },
    { id: "notifications", service: notifications, methods: methodsWithPrefix("notification."), state: value => value?.available === false ? "unavailable" : value?.lastError ? "error" : value?.running ? "ready" : "disabled" },
    { id: "terminal-broadcast", service: engineApi, methods: ["terminal.broadcast.preview", "terminal.broadcast"], state: () => "ready" },
    { id: "crashlens-free-port", service: portInspector, methods: ["crashlens.port.inspect"], state: value => value?.available === false ? "unavailable" : "ready" },
    { id: "services", service: localServiceRegistry, methods: ["services.list", "services.open", "services.copy", "services.owner", "services.inspectPort"], state: () => "ready" },
    { id: "usage", service: usageLedger, methods: ["usage.query", "usage.import"], state: () => "ready" },
    { id: "terminal-windows", service: terminalWindowManager, methods: ["terminal.window.list", "terminal.window.detach", "terminal.window.recall", "terminal.window.focus"], state: () => "ready" },
    { id: "workspace-browser", service: workspaceBrowser, methods: methodsWithPrefix("workspace.browser."), state: () => "ready" },
    { id: "recovery", service: sessionRecoveryService, methods: ["recovery.inspect", "recovery.propose", "recovery.resume"], state: () => "ready" },
    { id: "agent-activity", service: agentActivityService, methods: ["agents.activity"], state: () => "ready" },
    { id: "assistant", service: aiAssistant, methods: methodsWithPrefix("ai."), state: value => value?.mission?.available || value?.keys?.length ? "ready" : "disabled" }
  ];

  async function inspectCapability(definition) {
    const checkedAt = now();
    if (!definition.service) {
      return { id: definition.id, support: "unavailable", state: "unavailable", methods: [], reason: definition.reason, checkedAt };
    }
    try {
      const value = typeof definition.service.status === "function" ? await definition.service.status() : null;
      const state = definition.state(value);
      return {
        id: definition.id,
        support: "supported",
        state: CAPABILITY_STATES.includes(state) ? state : "ready",
        methods: [...definition.methods],
        reason: state === "unavailable" ? String(value?.error || value?.lastError || "Required platform support is unavailable").slice(0, 240) : null,
        checkedAt
      };
    } catch (error) {
      return { id: definition.id, support: "supported", state: "error", methods: [...definition.methods], reason: String(error?.message || error).slice(0, 240), checkedAt };
    }
  }

  async function capabilitySnapshot() {
    const entries = await Promise.all(capabilityDefinitions.map(inspectCapability));
    return Object.fromEntries(entries.map(entry => [entry.id, entry]));
  }

  function safeSend(message) {
    if (disposed) return false;
    try {
      const result = send(message);
      if (result && typeof result.catch === "function") result.catch(() => {});
      return true;
    } catch (error) {
      return false;
    }
  }

  function eventFrame(event) {
    return {
      version: PROTOCOL_VERSION,
      type: "engine:event",
      sequence: Number.isInteger(event?.sequence) ? event.sequence : null,
      event
    };
  }

  function onEngineEvent(event) {
    if (disposed || event?.type === "session:output") return;
    if (eventMode === "active") {
      safeSend(eventFrame(event));
      return;
    }
    eventQueue.push(event);
    if (eventQueue.length > MAX_EVENT_QUEUE) {
      const removed = eventQueue.splice(0, eventQueue.length - MAX_EVENT_QUEUE);
      eventDroppedThrough = removed.at(-1)?.sequence || eventDroppedThrough;
    }
  }

  const unsubscribeEvents = engineApi.subscribe("all", onEngineEvent);
  const unsubscribeVSCode = typeof vscodeBridge?.subscribe === "function"
    ? vscodeBridge.subscribe(status => safeSend({
        version: PROTOCOL_VERSION,
        type: "integration:event",
        integration: "vscode",
        status
      }))
    : null;
  const unsubscribeMcp = typeof mcpGateway?.subscribe === "function"
    ? mcpGateway.subscribe(status => safeSend({
        version: PROTOCOL_VERSION,
        type: "integration:event",
        integration: "mcp",
        status
      }))
    : null;
  const unsubscribeMobile = typeof mobileCompanion?.subscribe === "function"
    ? mobileCompanion.subscribe(status => safeSend({
        version: PROTOCOL_VERSION,
        type: "integration:event",
        integration: "mobile",
        status
      }))
    : null;
  // T036 — clicking a native notification has to land on the thing it is about.
  const unsubscribeNotifications = typeof notifications?.subscribe === "function"
    ? notifications.subscribe(payload => safeSend({
        version: PROTOCOL_VERSION,
        type: "notification:activate",
        route: payload?.route || "needs",
        attentionId: payload?.attentionId || null,
        sessionId: payload?.sessionId || null,
        // Which button on the Windows toast was pressed, so the app finishes
        // the job (focus the terminal, open Needs You) rather than only
        // surfacing the window.
        notificationId: payload?.notificationId || null,
        actionId: payload?.actionId || null
      }))
    : null;

  function closeTerminal(streamId) {
    const state = terminalStreams.get(streamId);
    if (!state) return false;
    terminalStreams.delete(streamId);
    state.closed = true;
    if (state.flushHandle) clearImmediate(state.flushHandle);
    state.flushHandle = null;
    for (const cleanup of [state.offData, state.offExit]) {
      try { cleanup?.(); } catch (error) { /* Cleanup is best effort. */ }
    }
    state.offData = null;
    state.offExit = null;
    state.output.clear();
    return true;
  }

  function requireTerminal(params) {
    const streamId = requireString(params, "streamId");
    const state = terminalStreams.get(streamId);
    if (!state || state.closed) {
      throw new ProtocolError("TERMINAL_STALE", `terminal stream is stale or missing: ${streamId}`);
    }
    if (params.terminalEpoch !== undefined && params.terminalEpoch !== state.terminalEpoch) {
      throw new ProtocolError("TERMINAL_STALE", `terminal stream epoch is stale: ${streamId}`);
    }
    return state;
  }

  // Two views can watch one terminal, but only one may type into it. The lease
  // is checked here rather than in React because a renderer that lost the
  // handoff — or never respected it — still reaches this method.
  function requireWriteAuthority(state) {
    if (!terminalLeases || typeof terminalLeases.isAuthorized !== "function") return;
    if (terminalLeases.isAuthorized(state.sessionId, viewId())) return;
    throw new ProtocolError(
      "TERMINAL_NOT_AUTHORIZED",
      "This terminal is open in another window. Recall it to type here."
    );
  }

  function sendTerminalExit(state) {
    if (!state.active || !state.exitInfo || state.exitSent || state.closed) return;
    state.exitSent = true;
    safeSend({
      version: PROTOCOL_VERSION,
      type: "terminal:exit",
      streamId: state.streamId,
      terminalEpoch: state.terminalEpoch,
      sessionId: state.sessionId,
      exit: state.exitInfo
    });
  }

  function flushTerminal(state) {
    if (state.closed || !state.active) return;
    state.flushHandle = null;
    let batch;
    while ((batch = state.output.drainBatch())) {
      if (batch.droppedBytes) {
        safeSend({
          version: PROTOCOL_VERSION,
          type: "terminal:overflow",
          streamId: state.streamId,
          terminalEpoch: state.terminalEpoch,
          sessionId: state.sessionId,
          droppedBytes: batch.droppedBytes
        });
      }
      safeSend({
        version: PROTOCOL_VERSION,
        type: "terminal:data",
        streamId: state.streamId,
        terminalEpoch: state.terminalEpoch,
        sessionId: state.sessionId,
        data: batch.data
      });
    }
    sendTerminalExit(state);
  }

  function scheduleTerminalFlush(state) {
    if (state.closed || !state.active || state.flushHandle) return;
    state.flushHandle = setImmediate(() => flushTerminal(state));
    state.flushHandle.unref?.();
  }

  function prepareEventActivation(afterSequence) {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new ProtocolError("INVALID_PARAMS", "afterSequence must be a non-negative integer");
    }
    if (snapshotSequence === null) {
      throw new ProtocolError("SNAPSHOT_REQUIRED", "state.get must be called before events.activate");
    }
    if (afterSequence !== snapshotSequence) {
      throw new ProtocolError("STALE_SNAPSHOT", "afterSequence must match the latest state snapshot sequence");
    }
    if (eventDroppedThrough > afterSequence) {
      throw new ProtocolError("EVENT_GAP", "queued events overflowed; obtain a new state snapshot");
    }
    eventMode = "flushing";
    return () => {
      while (eventQueue.length) {
        const event = eventQueue.shift();
        if (event.sequence > afterSequence) safeSend(eventFrame(event));
      }
      eventMode = "active";
    };
  }

  async function callProject(method, operation) {
    if (!projectService || typeof projectService[method] !== "function") {
      throw new ProtocolError("UNAVAILABLE", "project management is not available on this connection");
    }
    try {
      return await operation(projectService[method].bind(projectService));
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      const code = typeof error?.code === "string" && error.code
        ? error.code
        : "PROJECT_ERROR";
      throw new ProtocolError(code, error instanceof Error ? error.message : String(error));
    }
  }

  async function callVSCode(method, operation) {
    if (!vscodeBridge || typeof vscodeBridge[method] !== "function") {
      throw new ProtocolError("UNAVAILABLE", "VS Code Bridge is not available on this connection");
    }
    try {
      return await operation(vscodeBridge[method].bind(vscodeBridge));
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      throw new ProtocolError(
        error instanceof TypeError ? "INVALID_PARAMS" : "VSCODE_BRIDGE_ERROR",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  // T114 — the three record sets that together are "what happened", read from
  // the same services the individual screens use. `decisions.list` already
  // isolates a failing source rather than counting it as zero, and the model
  // carries that judgement through instead of re-deciding it.
  async function readHistoryModel(params = {}) {
    const limit = Number.isInteger(params.limit) && params.limit > 0 ? Math.min(params.limit, 500) : 200;
    const activity = engineApi.getActivity({ limit });
    let decisions = [];
    try {
      const query = await buildDecisionQuery({ engineApi, missionSupervisor, mcpGateway, mobileCompanion });
      decisions = Array.isArray(query?.records) ? query.records : [];
    } catch {
      // buildDecisionQuery isolates its own sources; a throw here means the
      // query itself failed, which the model reports as a blind source.
      decisions = null;
    }
    let recipes = null;
    try { recipes = engineApi.listRecipes(); } catch { recipes = null; }
    return buildHistoryModel({
      activity: Array.isArray(activity?.events) ? activity.events : null,
      decisions,
      recipes
    });
  }

  async function callMissionAi(method, operation) {
    if (!missionAi || typeof missionAi[method] !== "function") {
      throw new ProtocolError("UNAVAILABLE", "Built-in Mission AI is not available on this connection");
    }
    try {
      return await operation(missionAi[method].bind(missionAi));
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      throw new ProtocolError(
        error instanceof TypeError ? "INVALID_PARAMS" : "MISSION_AI_ERROR",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  async function callMissionSupervisor(method, operation) {
    if (!missionSupervisor || typeof missionSupervisor[method] !== "function") {
      throw new ProtocolError("UNAVAILABLE", "Mission Supervisor is not available on this connection");
    }
    try { return await operation(missionSupervisor[method].bind(missionSupervisor)); }
    catch (error) {
      if (error instanceof ProtocolError) throw error;
      throw new ProtocolError(error instanceof TypeError ? "INVALID_PARAMS" : "MISSION_SUPERVISOR_ERROR", error instanceof Error ? error.message : String(error));
    }
  }

  async function callMcp(method, operation) {
    if (!mcpGateway || typeof mcpGateway[method] !== "function") {
      throw new ProtocolError("UNAVAILABLE", "Secure MCP Gateway is not available on this connection");
    }
    try {
      return await operation(mcpGateway[method].bind(mcpGateway));
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      throw new ProtocolError(
        error instanceof TypeError ? "INVALID_PARAMS" : "MCP_GATEWAY_ERROR",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  async function callMobile(method, operation) {
    if (!mobileCompanion || typeof mobileCompanion[method] !== "function") {
      throw new ProtocolError("UNAVAILABLE", "Mobile Companion is not available on this connection");
    }
    try { return await operation(mobileCompanion[method].bind(mobileCompanion)); }
    catch (error) {
      if (error instanceof ProtocolError) throw error;
      throw new ProtocolError(error instanceof TypeError ? "INVALID_PARAMS" : "MOBILE_COMPANION_ERROR", error instanceof Error ? error.message : String(error));
    }
  }

  function refuseForPlan(refusal) {
    if (!refusal) return;
    throw new ProtocolError("PLAN_REQUIRED", refusal.message, typeof refusal.toJSON === "function" ? refusal.toJSON() : null);
  }

  function runningWorkers() {
    try {
      if (typeof engineApi.runningCount === "function") return engineApi.runningCount();
      return (engineApi.list?.() || []).filter(session => session.status === "running" || session.status === "starting").length;
    } catch {
      return 0;
    }
  }

  function currentProjectIdSafely() {
    try {
      const listed = projectService?.list?.();
      return listed && typeof listed.then !== "function" ? listed.currentProjectId || null : null;
    } catch {
      return null;
    }
  }

  function recipeList() {
    try { return engineApi.listRecipes() || []; } catch { return []; }
  }

  function byokKeys() {
    try { return aiAssistant?.status?.().keys || []; } catch { return []; }
  }

  function projectSwitchRefusal(gate, method, params) {
    const workspace = (() => { try { return engineApi.getWorkspace?.() || null; } catch { return null; } })();
    const sameProject = method === "project.open" && typeof params.projectId === "string" && params.projectId === currentProjectIdSafely();
    return gate.checkProjectSwitch({ currentPersistent: Boolean(workspace?.persistent), sameProject });
  }

  // Everything the plan decides, in one place: method -> the refusal, if any.
  // Status reads are never refused, so a locked feature still shows what it
  // would do. (A lookup table rather than a switch keeps each method's handler
  // the only "case" for it in this file.)
  const PLAN_RULES = Object.freeze({
    "action.dispatch": (gate, params) => {
      const type = isPlainObject(params.action) ? params.action.type : null;
      if (type === "create" || type === "instantiateSavedCommand") return gate.checkCreateTerminal((engineApi.list?.() || []).length);
      if (type === "start" || type === "restart") {
        const target = typeof params.sessionId === "string" ? engineApi.getSnapshot(params.sessionId) : null;
        if (target && target.status !== "running" && target.status !== "starting") return gate.checkRunTerminal(runningWorkers());
      }
      return null;
    },
    "agent.create": gate => gate.checkCreateTerminal((engineApi.list?.() || []).length),
    "recipe.save": (gate, params) => {
      const recipes = recipeList();
      const id = isPlainObject(params.recipe) && typeof params.recipe.id === "string" ? params.recipe.id : null;
      return id && recipes.some(recipe => recipe?.id === id) ? gate.checkRecipeUse() : gate.checkRecipeCreate(recipes.length);
    },
    "recipe.run": gate => gate.checkRecipeUse(),
    "recipe.resume": gate => gate.checkRecipeUse(),
    "project.choose": (gate, params) => projectSwitchRefusal(gate, "project.choose", params),
    "project.open": (gate, params) => projectSwitchRefusal(gate, "project.open", params),
    "project.initialize": (gate, params) => projectSwitchRefusal(gate, "project.initialize", params),
    "mcp.configure": (gate, params) => (isPlainObject(params.configuration) && params.configuration.enabled === true ? gate.checkMcp() : null),
    "mcp.getToken": gate => gate.checkMcp(),
    "mcp.rotateToken": gate => gate.checkMcp(),
    "mcp.installClient": gate => gate.checkMcp(),
    "mcp.tools.list": gate => gate.checkMcp(),
    "mcp.tool.call": gate => gate.checkMcp(),
    "mobile.configure": (gate, params) => (isPlainObject(params.configuration) && params.configuration.enabled === true ? gate.checkMobile() : null),
    "mobile.invite": gate => gate.checkMobile(),
    "vscode.launch": gate => gate.checkVsCode(),
    "vscode.openFile": gate => gate.checkVsCode(),
    "vscode.openProblems": gate => gate.checkVsCode(),
    "vscode.terminal.create": gate => gate.checkVsCode(),
    "vscode.terminal.write": gate => gate.checkVsCode(),
    "vscode.terminal.focus": gate => gate.checkVsCode(),
    "vscode.terminal.close": gate => gate.checkVsCode(),
    "ai.byok.add": gate => gate.checkByokAdd(byokKeys().length),
    "ai.selection.set": (gate, params) => {
      const target = isPlainObject(params.target) ? params.target : null;
      if (target?.source !== "byok") return null;
      const keys = byokKeys();
      return gate.allowedByokKeyIds(keys).has(String(target.keyId || "")) ? null : gate.checkByokAdd(Math.max(keys.length, gate.byokLimit() ?? 0));
    }
  });

  function enforcePlan(method, params) {
    if (!planGate || !Object.hasOwn(PLAN_RULES, method)) return;
    let gate;
    try { gate = planGate.entitlements(); } catch { gate = null; }
    if (!gate) return;
    refuseForPlan(PLAN_RULES[method](gate, params));
  }

  function projectSelector(params) {
    if (typeof params.projectId === "string" && params.projectId) return params.projectId;
    if (typeof params.selectionToken === "string" && params.selectionToken) return params.selectionToken;
    throw new ProtocolError("INVALID_PARAMS", "projectId or selectionToken is required");
  }

  async function dispatchMethod(method, params) {
    enforcePlan(method, params);
    switch (method) {
      case "system.hello": {
        const state = engineApi.getState();
        const capabilities = await capabilitySnapshot();
        return {
          result: {
            protocolVersion: PROTOCOL_VERSION,
            engineContractVersion: state.contractVersion,
            methods: [...METHODS],
            capabilities,
            confirmation: {
              version: 2,
              method: "confirmation.request",
              binding: "method-and-exact-params",
              singleUse: true,
              legacyPredictableTokens: false,
              ttlMs: CONFIRMATION_TTL_MS,
              maxPendingPerConnection: MAX_PENDING_CONFIRMATIONS
            },
            limits: {
              maxRequestBytes: MAX_REQUEST_BYTES,
              maxTerminalInputBytes: MAX_TERMINAL_INPUT_BYTES,
              maxTerminalQueueBytes: MAX_TERMINAL_QUEUE_BYTES,
              maxTerminalDimension: MAX_TERMINAL_DIMENSION
            }
          }
        };
      }
      case "confirmation.request": {
        const targetMethod = requireString(params, "targetMethod");
        if (!isPlainObject(params.targetParams)) throw new ProtocolError("INVALID_PARAMS", "targetParams is required");
        return { result: issueConfirmation(targetMethod, params.targetParams) };
      }
      case "system.recovery.get": {
        if (!recoveryService || typeof recoveryService.getStatus !== "function") {
          throw new ProtocolError("UNAVAILABLE", "renderer recovery status is not available on this connection");
        }
        return { result: recoveryService.getStatus() };
      }
      case "state.get": {
        const state = engineApi.getState();
        snapshotSequence = state.sequence;
        eventMode = "queued";
        return { result: state };
      }
      case "events.activate": {
        const afterSend = prepareEventActivation(params.afterSequence);
        return {
          result: { active: true, afterSequence: params.afterSequence },
          afterSend
        };
      }
      case "activity.get":
        return { result: engineApi.getActivity(params) };
      case "memory.summary":
        return { result: engineApi.getProjectMemory({ afterSequence: params.afterSequence }) };
      // T114 - activity, decisions and recipe runs answered as one model, so
      // "what happened on this project" stops being three different screens.
      case "history.model":
        return { result: await readHistoryModel(params) };
      // T113 - the export is rendered here because the redactor lives here.
      // A renderer-side writer would be a second, unaudited copy of the rules.
      case "history.export": {
        const format = params.format === undefined ? "json" : requireString(params, "format");
        try {
          return {
            result: exportHistory({
              model: await readHistoryModel(params),
              format,
              filter: isPlainObject(params.filter) ? params.filter : {},
              project: typeof params.project === "string" && params.project.trim() ? params.project : "Project"
            })
          };
        } catch (error) {
          if (error instanceof TypeError) throw new ProtocolError("INVALID_PARAMS", error.message);
          throw error;
        }
      }
      case "context.snapshot": {
        try {
          return { result: missionContext.snapshot(params) };
        } catch (error) {
          if (error instanceof TypeError) {
            throw new ProtocolError("INVALID_PARAMS", error.message);
          }
          throw error;
        }
      }
      case "supervision.get": {
        try {
          return { result: projectSupervision.snapshot({
            afterSequence: Number.isInteger(params.afterSequence) && params.afterSequence >= 0 ? params.afterSequence : 0,
            includeOutput: false
          }) };
        } catch (error) {
          if (error instanceof TypeError) throw new ProtocolError("INVALID_PARAMS", error.message);
          throw error;
        }
      }
      case "missionAi.status":
        return { result: await callMissionAi("status", status => status()) };
      case "missionAi.configure": {
        if (!isPlainObject(params.configuration)) throw new ProtocolError("INVALID_PARAMS", "configuration is required");
        return { result: await callMissionAi("configure", configure => configure(params.configuration)) };
      }
      case "missionAi.ask": {
        const question = requireString(params, "question");
        return { result: await callMissionAi("ask", ask => ask({ question, afterSequence: params.afterSequence })) };
      }
      // T115 - Mission AI, VS Code and Automation now answer the same audit
      // question MCP and Mobile already did. All three reads are
      // metadata-only; none can expose a question, a key, editor text or
      // terminal output.
      case "missionAi.audit.list":
        return { result: await callMissionAi("listAudit", listAudit => listAudit(params.limit)) };
      case "missionAi.clear": {
        requireConfirmation("missionAi.clear", params);
        return { result: await callMissionAi("clear", clear => clear()) };
      }
      case "missionSupervisor.status":
        return { result: await callMissionSupervisor("status", status => status()) };
      case "missionSupervisor.plan": {
        const instruction = requireString(params, "instruction");
        return { result: await callMissionSupervisor("propose", propose => propose({ instruction, afterSequence: params.afterSequence })) };
      }
      case "missionSupervisor.approval.list":
        return { result: await callMissionSupervisor("listApprovals", list => list()) };
      case "missionSupervisor.approval.resolve": {
        const approvalId = requireString(params, "approvalId");
        if (!["approve", "deny"].includes(params.decision)) throw new ProtocolError("INVALID_PARAMS", "decision must be approve or deny");
        requireConfirmation("missionSupervisor.approval.resolve", params);
        return { result: await callMissionSupervisor("resolve", resolve => resolve(approvalId, params.decision)) };
      }
      case "workspace.get":
        return { result: engineApi.getWorkspace() };
      case "integration.list": {
        const bridgeStatus = typeof vscodeBridge?.status === "function" ? vscodeBridge.status() : null;
        const missionAiStatus = typeof missionAi?.status === "function" ? missionAi.status() : null;
        const mcpStatus = typeof mcpGateway?.status === "function" ? mcpGateway.status() : null;
        const mobileStatus = typeof mobileCompanion?.status === "function" ? mobileCompanion.status() : null;
        return { result: engineApi.listIntegrations().map(item => {
          if (item.id === "vscode") return { ...item, enabled: bridgeStatus?.connected === true, bridge: bridgeStatus };
          if (item.id === "mission-ai") return { ...item, enabled: missionAiStatus?.configured === true, missionAi: missionAiStatus };
          if (item.id === "assistant") return { ...item, status: "available", enabled: mcpStatus?.running === true, mcp: mcpStatus };
          if (item.id === "mobile") return { ...item, status: "available", enabled: mobileStatus?.running === true, mobile: mobileStatus };
          return item;
        }) };
      }
      case "vscode.status":
        return { result: await callVSCode("status", status => status()) };
      case "vscode.audit.list":
        return { result: await callVSCode("listAudit", listAudit => listAudit(params.limit)) };
      case "vscode.launch":
        return { result: await callVSCode("launch", launch => launch()) };
      case "vscode.openFile": {
        const relativePath = requireString(params, "relativePath");
        return { result: await callVSCode("openFile", openFile => openFile({ relativePath, line: params.line, column: params.column })) };
      }
      case "vscode.openProblems":
        return { result: await callVSCode("openProblems", openProblems => openProblems()) };
      case "vscode.terminal.create": {
        requireConfirmation("vscode.terminal.create", params);
        return { result: await callVSCode("createManagedTerminal", create => create({ name: params.name, cwd: params.cwd })) };
      }
      case "vscode.terminal.write": {
        const terminalId = requireString(params, "terminalId");
        const input = requireString(params, "input");
        if (byteLength(input) > 4096 || /[\0\r\n]/.test(input)) throw new ProtocolError("INVALID_PARAMS", "input must be one terminal command of at most 4096 bytes");
        requireConfirmation("vscode.terminal.write", params);
        return { result: await callVSCode("writeManagedTerminal", write => write({ terminalId, input, addNewLine: params.addNewLine })) };
      }
      case "vscode.terminal.focus": {
        const terminalId = requireString(params, "terminalId");
        return { result: await callVSCode("focusManagedTerminal", focus => focus({ terminalId })) };
      }
      case "vscode.terminal.close": {
        const terminalId = requireString(params, "terminalId");
        requireConfirmation("vscode.terminal.close", params);
        return { result: await callVSCode("closeManagedTerminal", close => close({ terminalId })) };
      }
      case "vscode.disconnect":
        return { result: { disconnected: await callVSCode("disconnect", disconnect => disconnect("renderer-request")) } };
      case "mcp.status":
        return { result: await callMcp("status", status => status()) };
      case "mcp.getToken":
        return { result: await callMcp("getToken", getToken => getToken()) };
      case "mcp.configure": {
        if (!isPlainObject(params.configuration)) throw new ProtocolError("INVALID_PARAMS", "configuration is required");
        return { result: await callMcp("configure", configure => configure(params.configuration)) };
      }
      case "mcp.rotateToken": {
        requireConfirmation("mcp.rotateToken", params);
        return { result: await callMcp("rotateToken", rotateToken => rotateToken()) };
      }
      case "mcp.installClient": {
        const target = requireString(params, "target");
        const workspacePath = typeof params.workspacePath === "string" ? params.workspacePath : "";
        return { result: await callMcp("installClient", installClient => installClient({ target, workspacePath })) };
      }
      case "mcp.removeClient":
      case "mcp.uninstallClient": {
        const target = requireString(params, "target");
        const workspacePath = typeof params.workspacePath === "string" ? params.workspacePath : "";
        return { result: await callMcp("removeClient", removeClient => removeClient({ target, workspacePath })) };
      }
      case "mcp.clientStatus": {
        const workspacePath = typeof params.workspacePath === "string" ? params.workspacePath : "";
        return { result: await callMcp("clientStatus", clientStatus => clientStatus({ workspacePath })) };
      }
      case "mcp.tools.list":
        return {
          result: await callMcp("dispatchRequest", dispatchRequest =>
            dispatchRequest({ jsonrpc: "2.0", id: "ui-list", method: "tools/list", params: {} }, { protocolVersion: "2026-07-28", client: "Groundstation In-App Tester" })
          )
        };
      case "mcp.tool.call": {
        const name = requireString(params, "name");
        const toolArgs = isPlainObject(params.arguments) ? params.arguments : {};
        return {
          result: await callMcp("dispatchRequest", dispatchRequest =>
            dispatchRequest({ jsonrpc: "2.0", id: "ui-call", method: "tools/call", params: { name, arguments: toolArgs } }, { protocolVersion: "2026-07-28", client: "Groundstation In-App Tester" })
          )
        };
      }
      case "mcp.approval.list":
        return { result: await callMcp("listApprovals", listApprovals => listApprovals()) };
      case "mcp.approval.resolve": {
        const approvalId = requireString(params, "approvalId");
        const decision = requireString(params, "decision");
        requireConfirmation("mcp.approval.resolve", params);
        return { result: await callMcp("resolveApproval", resolveApproval => resolveApproval(approvalId, decision)) };
      }
      case "mcp.audit.list":
        return { result: await callMcp("listAudit", listAudit => listAudit(params.limit)) };
      case "mobile.status":
        return { result: await callMobile("status", status => status()) };
      case "mobile.configure": {
        if (!isPlainObject(params.configuration)) throw new ProtocolError("INVALID_PARAMS", "configuration is required");
        return { result: await callMobile("configure", configure => configure(params.configuration)) };
      }
      case "mobile.invite": {
        requireConfirmation("mobile.invite", params);
        return { result: await callMobile("createInvitation", createInvitation => createInvitation()) };
      }
      case "mobile.device.list":
        return { result: await callMobile("listDevices", listDevices => listDevices()) };
      case "mobile.device.revoke": {
        const deviceId = requireString(params, "deviceId");
        requireConfirmation("mobile.device.revoke", params);
        return { result: await callMobile("revokeDevice", revokeDevice => revokeDevice(deviceId)) };
      }
      case "mobile.approval.list":
        return { result: await callMobile("listApprovals", listApprovals => listApprovals()) };
      case "mobile.approval.resolve": {
        const approvalId = requireString(params, "approvalId");
        const decision = requireString(params, "decision");
        requireConfirmation("mobile.approval.resolve", params);
        return { result: await callMobile("resolveApproval", resolveApproval => resolveApproval(approvalId, decision)) };
      }
      case "mobile.audit.list":
        return { result: await callMobile("listAudit", listAudit => listAudit(params.limit)) };
      case "recipe.list":
        return { result: engineApi.listRecipes() };
      case "recipe.save": {
        if (!isPlainObject(params.recipe)) throw new ProtocolError("INVALID_PARAMS", "recipe is required");
        const result = engineApi.saveRecipe(params.recipe);
        // T076 — a conflict is a distinct outcome from a validation failure: the
        // edit was well-formed, someone else just got there first. Its own code
        // lets a client offer "reload" instead of "fix your input".
        if (result?.conflict) throw new ProtocolError("RECIPE_CONFLICT", result.error);
        if (!result?.ok) throw new ProtocolError("ACTION_FAILED", result?.error || "recipe could not be saved");
        return { result };
      }
      case "recipe.delete": {
        const recipeId = requireString(params, "recipeId");
        requireConfirmation("recipe.delete", params);
        const result = engineApi.deleteRecipe(recipeId);
        if (!result?.ok) throw new ProtocolError("ACTION_FAILED", result?.error || "recipe could not be deleted");
        return { result };
      }
      case "recipe.run":
      case "recipe.pause":
      case "recipe.resume":
      case "recipe.cancel": {
        const recipeId = requireString(params, "recipeId");
        const operation = method === "recipe.run" ? "runRecipe" : method === "recipe.pause" ? "pauseRecipe" : method === "recipe.resume" ? "resumeRecipe" : "cancelRecipe";
        const result = engineApi[operation](recipeId, method === "recipe.run" ? { recover: params.recover === true } : undefined);
        if (!result?.ok) throw new ProtocolError("ACTION_FAILED", result?.error || `${method} failed`);
        return { result };
      }
      case "automation.list":
        return { result: engineApi.listAutomations() };
      case "automation.audit.list": {
        // The engine already keeps this ring; it simply had no way out.
        const limit = Number.isInteger(params.limit) && params.limit > 0 ? Math.min(params.limit, 50) : 50;
        const audit = engineApi.listAutomations()?.audit;
        return { result: Array.isArray(audit) ? audit.slice(0, limit) : [] };
      }
      case "automation.save": {
        if (!isPlainObject(params.automation)) throw new ProtocolError("INVALID_PARAMS", "automation is required");
        const result = engineApi.saveAutomation(params.automation);
        if (!result?.ok) throw new ProtocolError("ACTION_FAILED", result?.error || "automation could not be saved");
        return { result };
      }
      case "automation.delete": {
        const automationId = requireString(params, "automationId");
        requireConfirmation("automation.delete", params);
        const result = engineApi.deleteAutomation(automationId);
        if (!result?.ok) throw new ProtocolError("ACTION_FAILED", result?.error || "automation could not be deleted");
        return { result };
      }
      case "automation.test": {
        const automationId = requireString(params, "automationId");
        const result = engineApi.testAutomation(automationId);
        if (!result?.ok) throw new ProtocolError("ACTION_FAILED", result?.error || "automation dry run failed");
        return { result };
      }
      case "automation.approval.resolve": {
        const approvalId = requireString(params, "approvalId");
        const decision = requireString(params, "decision");
        requireConfirmation("automation.approval.resolve", params);
        const result = await engineApi.resolveAutomationApproval(approvalId, decision);
        if (!result?.ok) throw new ProtocolError("ACTION_FAILED", result?.error || "automation approval could not be resolved");
        return { result };
      }
      case "session.get": {
        const sessionId = requireString(params, "sessionId");
        const session = engineApi.getSnapshot(sessionId);
        if (!session) throw new ProtocolError("NOT_FOUND", `no such session: ${sessionId}`);
        return { result: session };
      }
      case "session.configuration.get": {
        const sessionId = requireString(params, "sessionId");
        const configuration = engineApi.getSessionConfiguration(sessionId);
        if (!configuration) throw new ProtocolError("NOT_FOUND", `no such session: ${sessionId}`);
        return { result: configuration };
      }
      case "preset.list":
        return { result: engineApi.listSavedCommands() };
      case "agents.list":
        return { result: listAgentAdapters(agentAdapterOptions) };
      case "agent.create": {
        const adapterId = requireString(params, "adapterId");
        let definition;
        try {
          definition = createAgentDefinition(adapterId, agentAdapterOptions);
        } catch (error) {
          throw new ProtocolError("INVALID_PARAMS", error.message);
        }
        const result = await router.dispatch(null, { type: "create", definition });
        if (!result?.ok) {
          throw new ProtocolError("ACTION_FAILED", result?.error || "agent worker could not be created");
        }
        return { result: { created: true, sessionId: definition.id, adapterId } };
      }
      case "mission.list":
        return { result: engineApi.listMissions() };
      case "mission.save": {
        if (!isPlainObject(params.mission)) throw new ProtocolError("INVALID_PARAMS", "mission is required");
        const result = engineApi.saveMission(params.mission);
        if (!result?.ok) throw new ProtocolError("ACTION_FAILED", result?.error || "mission could not be saved");
        return { result };
      }
      case "mission.instruction.record": {
        const agentId = requireString(params, "agentId");
        const result = engineApi.recordMissionInstruction(agentId, { instructionLength: params.instructionLength, requestedScopes: params.requestedScopes, approvalId: params.approvalId });
        if (!result?.ok) throw new ProtocolError("ACTION_FAILED", result?.error || "instruction scope denied");
        return { result };
      }
      case "mission.transition": {
        const missionId = requireString(params, "missionId");
        const state = requireString(params, "state");
        requireConfirmation("mission.transition", params);
        const result = engineApi.transitionMission(missionId, state);
        if (!result?.ok) throw new ProtocolError("ACTION_FAILED", result?.error || "mission transition failed");
        return { result };
      }
      case "mission.checkpoint.verify": {
        const missionId = requireString(params, "missionId");
        const checkpointId = requireString(params, "checkpointId");
        requireConfirmation("mission.checkpoint.verify", params);
        const result = engineApi.verifyMissionCheckpoint(missionId, checkpointId);
        if (!result?.ok) throw new ProtocolError("ACTION_FAILED", result?.error || "mission checkpoint could not be verified");
        return { result };
      }
      case "mission.approval.list":
        return { result: engineApi.listMissionApprovals() };
      case "mission.approval.request": {
        const agentId = requireString(params, "agentId");
        const result = engineApi.requestMissionApproval(agentId, { scopes: params.scopes, reason: params.reason, impact: params.impact });
        if (!result?.ok) throw new ProtocolError("ACTION_FAILED", result?.error || "mission approval could not be requested");
        return { result };
      }
      case "mission.approval.resolve": {
        const missionId = requireString(params, "missionId");
        const approvalId = requireString(params, "approvalId");
        const decision = requireString(params, "decision");
        requireConfirmation("mission.approval.resolve", params);
        const result = engineApi.resolveMissionApproval(missionId, approvalId, decision);
        if (!result?.ok) throw new ProtocolError("ACTION_FAILED", result?.error || "mission approval could not be resolved");
        return { result };
      }
      case "attention.list":
        return { result: engineApi.listAttention() };
      // T033/T037 — delivery lives in the main process because only it owns the
      // OS notification surface and the window to focus. The renderer reads its
      // state and can ask it to prove itself; it can never raise one directly.
      case "notification.status": {
        if (!notifications || typeof notifications.status !== "function") {
          return { result: { available: false, running: false, delivered: 0, suppressed: 0, lastDeliveryAt: null, lastSuppressedReason: null, lastError: null } };
        }
        return { result: notifications.status() };
      }
      case "notification.test": {
        if (!notifications || typeof notifications.test !== "function") {
          throw new ProtocolError("CAPABILITY_UNAVAILABLE", "desktop notifications are not available in this build");
        }
        return { result: notifications.test() };
      }
      case "decisions.list":
        return {
          result: await buildDecisionQuery({
            engineApi,
            missionSupervisor,
            mcpGateway,
            mobileCompanion
          })
        };
      case "decisions.acknowledge": {
        // Read/visibility state only — never resolves a decision.
        const { source, nativeId } = parseDecisionId(requireString(params, "id"));
        if (source === "session") {
          const result = engineApi.transitionAttention(nativeId, "seen");
          return { result: result?.ok ? result : { ok: true, acknowledged: false } };
        }
        // External sources carry no engine-side "seen" flag yet; the renderer
        // tracks acknowledgement locally. Report success without mutating anything.
        return { result: { ok: true, acknowledged: false, scope: "renderer-local" } };
      }
      case "decisions.resolve": {
        const id = requireString(params, "id");
        const actionId = requireString(params, "actionId");
        const { source, nativeId } = parseDecisionId(id);
        if (CONFIRMED_SOURCES.has(source)) {
          if (!["approve", "deny"].includes(actionId)) {
            throw new ProtocolError("INVALID_PARAMS", "actionId must be approve or deny");
          }
          requireConfirmation("decisions.resolve", params);
        }
        switch (source) {
          case "missionSupervisor":
            return { result: await callMissionSupervisor("resolve", resolve => resolve(nativeId, actionId)) };
          case "mission": {
            const missionId = requireString(params, "missionId");
            const result = engineApi.resolveMissionApproval(missionId, nativeId, actionId);
            if (!result?.ok) throw new ProtocolError("ACTION_FAILED", result?.error || "mission approval could not be resolved");
            return { result };
          }
          case "mcp":
            return { result: await callMcp("resolveApproval", resolveApproval => resolveApproval(nativeId, actionId)) };
          case "automation": {
            const result = await engineApi.resolveAutomationApproval(nativeId, actionId);
            if (!result?.ok) throw new ProtocolError("ACTION_FAILED", result?.error || "automation approval could not be resolved");
            return { result };
          }
          case "mobile":
            return { result: await callMobile("resolveApproval", resolveApproval => resolveApproval(nativeId, actionId)) };
          case "session": {
            const state = actionId === "acknowledge" ? "seen" : actionId;
            const result = engineApi.transitionAttention(nativeId, state, { snoozedUntil: params.snoozedUntil });
            if (!result?.ok) throw new ProtocolError("ACTION_FAILED", result?.error || "attention lifecycle could not be updated");
            return { result };
          }
          default:
            throw new ProtocolError("INVALID_PARAMS", `unknown decision source: ${source || "(none)"}`);
        }
      }
      case "attention.transition": {
        const attentionId = requireString(params, "attentionId");
        const state = requireString(params, "state");
        const result = engineApi.transitionAttention(attentionId, state, { snoozedUntil: params.snoozedUntil });
        if (!result?.ok) throw new ProtocolError("ACTION_FAILED", result?.error || "attention lifecycle could not be updated");
        return { result };
      }
      case "attention.preferences.save": {
        if (!isPlainObject(params.preferences)) throw new ProtocolError("INVALID_PARAMS", "preferences are required");
        const result = engineApi.saveAttentionPreferences(params.preferences);
        if (!result?.ok) throw new ProtocolError("ACTION_FAILED", result?.error || "attention preferences could not be saved");
        return { result };
      }
      case "projects.list":
        return { result: await callProject("list", list => list()) };
      case "project.choose":
        return { result: await callProject("choose", choose => choose()) };
      case "project.open": {
        const selector = projectSelector(params);
        requireConfirmation("project.open", params);
        const result = await callProject("open", open => open(params));
        if (result?.changed !== false) vscodeBridge?.workspaceChanged?.();
        return { result };
      }
      case "project.initialize": {
        const selectionToken = requireString(params, "selectionToken");
        requireConfirmation("project.initialize", params);
        const result = await callProject("initialize", initialize => initialize(params));
        if (result?.changed !== false) vscodeBridge?.workspaceChanged?.();
        return { result };
      }
      case "project.removeRecent": {
        requireString(params, "projectId");
        return { result: await callProject("removeRecent", remove => remove(params)) };
      }
      case "action.dispatch": {
        const sessionId = params.sessionId === null || params.sessionId === undefined
          ? null
          : requireString(params, "sessionId");
        if (!isPlainObject(params.action) || typeof params.action.type !== "string") {
          throw new ProtocolError("INVALID_PARAMS", "action must be an object with a type");
        }
        const riskTier = router.riskTier(params.action.type);
        if (riskTier === "destructive") {
          requireConfirmation("action.dispatch", params);
        }
        const result = await router.dispatch(sessionId, params.action);
        if (!result?.ok) {
          throw new ProtocolError(result?.code === "PLAN_REQUIRED" ? "PLAN_REQUIRED" : "ACTION_FAILED", result?.error || "action failed");
        }
        return { result };
      }
      case "terminal.open": {
        const sessionId = requireString(params, "sessionId");
        if (terminalStreams.size >= MAX_OPEN_TERMINALS) {
          throw new ProtocolError("TERMINAL_LIMIT", "too many terminal streams are open");
        }
        if ([...terminalStreams.values()].some(state => !state.closed && state.sessionId === sessionId)) {
          throw new ProtocolError(
            "TERMINAL_ALREADY_OPEN",
            `a terminal stream is already open for session: ${sessionId}`
          );
        }
        const rawStream = engineApi.attachRawStream(sessionId);
        if (!rawStream) {
          throw new ProtocolError("TERMINAL_NOT_RUNNING", `session is not running: ${sessionId}`);
        }

        const streamId = crypto.randomUUID();
        const state = {
          streamId,
          terminalEpoch: crypto.randomUUID(),
          sessionId,
          rawStream,
          output: new BoundedOutputQueue(),
          active: false,
          closed: false,
          exitInfo: null,
          exitSent: false,
          flushHandle: null,
          offData: null,
          offExit: null
        };
        terminalStreams.set(streamId, state);

        try {
          state.offData = rawStream.onData((data, metadata = {}) => {
            if (state.closed) return;
            state.output.append(String(data), metadata.sequence);
            scheduleTerminalFlush(state);
          });
          state.offExit = rawStream.onExit(exit => {
            if (state.closed) return;
            state.exitInfo = isPlainObject(exit) ? { ...exit } : {};
            try { state.offData?.(); } catch (error) { /* Best effort. */ }
            try { state.offExit?.(); } catch (error) { /* Best effort. */ }
            state.offData = null;
            state.offExit = null;
            if (state.active) {
              if (state.flushHandle) clearImmediate(state.flushHandle);
              state.flushHandle = null;
              flushTerminal(state);
            }
          });
          const replay = terminalReplay(engineApi, sessionId, rawStream.replay?.());
          // The engine replay supplies an output-sequence checkpoint. Discard
          // only queued chunks represented by that checkpoint and retain every
          // later chunk. This makes the replay/live handoff atomic even when a
          // PTY emits while the replay is being captured.
          if (!state.output.discardThrough(replay.throughSequence)) {
            // Compatibility for third-party EngineAPI-compatible streams that
            // predate sequence checkpoints. Their old contract guaranteed that
            // replay already contained queued output.
            state.output.clear();
          }
          return {
            result: {
              streamId,
              terminalEpoch: state.terminalEpoch,
              sessionId,
              replay
            }
          };
        } catch (error) {
          closeTerminal(streamId);
          throw new ProtocolError(
            "TERMINAL_ERROR",
            error instanceof Error ? error.message : String(error)
          );
        }
      }
      case "terminal.activate": {
        const state = requireTerminal(params);
        state.active = true;
        return {
          result: { active: true, streamId: state.streamId, terminalEpoch: state.terminalEpoch },
          afterSend: () => flushTerminal(state)
        };
      }
      case "terminal.write": {
        const state = requireTerminal(params);
        if (state.exitInfo) {
          throw new ProtocolError("TERMINAL_NOT_RUNNING", "terminal has exited");
        }
        if (typeof params.data !== "string") {
          throw new ProtocolError("INVALID_PARAMS", "terminal data must be a string");
        }
        if (byteLength(params.data) > MAX_TERMINAL_INPUT_BYTES) {
          throw new ProtocolError(
            "TERMINAL_INPUT_TOO_LARGE",
            `terminal input cannot exceed ${MAX_TERMINAL_INPUT_BYTES} bytes`
          );
        }
        requireWriteAuthority(state);
        if (!state.rawStream.write(params.data, { source: "groundstation" })) {
          throw new ProtocolError("TERMINAL_NOT_RUNNING", "terminal is not running or write failed");
        }
        try { onTerminalInput?.(state.sessionId); } catch { /* an observer never blocks typing */ }
        return { result: { written: true } };
      }
      // T023 — broadcast is the one action that multiplies a mistake by the
      // number of workers, so it is split in two: a preview anybody can ask for,
      // and a dispatch that requires a token bound to the exact plan the preview
      // described. `broadcastGuard` owns the rules; this owns authority.
      case "terminal.broadcast.preview": {
        const plan = planBroadcast({
          sessions: engineApi.list(),
          sessionIds: params.sessionIds,
          input: params.input
        });
        return { result: { ...plan, limit: MAX_BROADCAST_TARGETS } };
      }
      case "terminal.broadcast": {
        const plan = planBroadcast({
          sessions: engineApi.list(),
          sessionIds: params.sessionIds,
          input: params.input
        });
        if (!plan.ok) throw new ProtocolError("BROADCAST_REFUSED", plan.error);
        // A destructive command still goes through, but only when the operator
        // has said so explicitly — the confirmation dialog alone is a habit.
        if (plan.requiresAcknowledgement && params.acknowledgeDestructive !== true) {
          throw new ProtocolError(
            "BROADCAST_ACKNOWLEDGEMENT_REQUIRED",
            `This command contains ${plan.destructive.map(item => item.label).join(" and ")}. Acknowledge the consequence for all ${plan.targets.length} workers before sending.`
          );
        }
        if (byteLength(params.input) > MAX_TERMINAL_INPUT_BYTES) {
          throw new ProtocolError("TERMINAL_INPUT_TOO_LARGE", `terminal input cannot exceed ${MAX_TERMINAL_INPUT_BYTES} bytes`);
        }
        // Bound to the exact target list and input, so a token issued for a
        // preview of two workers cannot be replayed against twelve.
        requireConfirmation("terminal.broadcast", params);

        const delivered = [];
        const failed = [];
        for (const target of plan.targets) {
          const rawStream = engineApi.attachRawStream(target.id);
          if (!rawStream) { failed.push({ id: target.id, name: target.name, reason: "not-running" }); continue; }
          try {
            if (rawStream.write(params.input, { source: "groundstation" })) delivered.push(target.id);
            else failed.push({ id: target.id, name: target.name, reason: "write-failed" });
          } catch (error) {
            failed.push({ id: target.id, name: target.name, reason: "write-failed" });
          }
        }
        // Audit records the shape of what happened, never the command text —
        // the same rule the confirmation audit already follows.
        recordConfirmation("completed", "terminal.broadcast", failed.length ? "PARTIAL_DELIVERY" : "DELIVERED");
        return { result: { delivered, failed, skipped: plan.skipped, targets: plan.targets.length } };
      }
      // T026 — read-only. There is deliberately no terminate method here: when
      // the listener turns out to be a supervised worker the renderer routes to
      // the existing confirmation-gated worker stop, and when it is a foreign
      // process OUTARCH reports it and stops. A crash banner is the
      // worst possible place to grant the power to kill arbitrary processes.
      case "crashlens.port.inspect": {
        if (!portInspector || typeof portInspector.inspect !== "function") {
          throw new ProtocolError("CAPABILITY_UNAVAILABLE", "port inspection is not available in this build");
        }
        const result = await portInspector.inspect(params.port);
        return { result: { ...result, summary: describePortOwner(result) } };
      }
      case "terminal.resize": {
        const state = requireTerminal(params);
        if (state.exitInfo) {
          throw new ProtocolError("TERMINAL_NOT_RUNNING", "terminal has exited");
        }
        const { cols, rows } = params;
        if (
          !Number.isInteger(cols) || !Number.isInteger(rows) ||
          cols < 1 || rows < 1 ||
          cols > MAX_TERMINAL_DIMENSION || rows > MAX_TERMINAL_DIMENSION
        ) {
          throw new ProtocolError(
            "INVALID_PARAMS",
            `terminal dimensions must be integers between 1 and ${MAX_TERMINAL_DIMENSION}`
          );
        }
        requireWriteAuthority(state);
        if (!state.rawStream.resize(cols, rows)) {
          throw new ProtocolError("TERMINAL_NOT_RUNNING", "terminal is not running or resize failed");
        }
        return { result: { resized: true, cols, rows } };
      }
      case "terminal.close": {
        const state = requireTerminal(params);
        closeTerminal(state.streamId);
        return { result: { closed: true } };
      }
      case "services.list": {
        if (!localServiceRegistry) return { result: { services: [], available: false } };
        return { result: { services: localServiceRegistry.listServices(params), available: true } };
      }
      // A toast or panel action carries a service ID, never a command or a raw
      // address. The address is re-resolved from the registry at click time so a
      // record that went stale since it was rendered cannot be opened.
      case "services.open":
      case "services.copy": {
        if (!localServiceRegistry) throw new ProtocolError("UNAVAILABLE", "local service discovery is not available");
        const serviceId = requireString(params, "serviceId");
        const service = localServiceRegistry.getService(serviceId);
        if (!service) {
          throw new ProtocolError("NOT_FOUND", "That service is no longer being reported by its worker. Check the terminal that started it.");
        }
        if (Number.isInteger(params?.expectedGeneration) && params.expectedGeneration !== service.generation) {
          throw new ProtocolError("CONFLICT", `${service.workerName} restarted since that address was shown. Open the current address from the Services panel.`);
        }
        const safeUrl = assertOpenableServiceUrl(service.url);
        if (method === "services.copy") {
          return { result: { ok: true, url: safeUrl, serviceId, generation: service.generation } };
        }
        // A worker advertised this address, so the default place to open it is
        // the workspace's own browser: following it should not cost the
        // operator the window they are working in. `external: true` is the
        // explicit way to hand it to the operating system instead.
        const wantsExternal = params?.external === true;
        if (!wantsExternal && workspaceBrowser) {
          const state = workspaceBrowser.open({ url: safeUrl, bounds: params?.bounds || null });
          return { result: { ok: true, opened: true, target: "workspace", url: safeUrl, serviceId, generation: service.generation, browser: state } };
        }
        if (typeof openServiceUrl !== "function") {
          throw new ProtocolError("UNAVAILABLE", "opening a browser is not available on this connection");
        }
        await openServiceUrl(safeUrl);
        return { result: { ok: true, opened: true, target: "system", url: safeUrl, serviceId, generation: service.generation } };
      }
      // Which worker owns a service, and what stopping it would take down with
      // it. A worker serving three ports has one stop, and the panel has to be
      // able to say so before the operator presses it.
      case "services.owner": {
        if (!localServiceRegistry) throw new ProtocolError("UNAVAILABLE", "local service discovery is not available");
        const serviceId = requireString(params, "serviceId");
        const service = localServiceRegistry.getService(serviceId);
        if (!service) throw new ProtocolError("NOT_FOUND", "That service is no longer being reported.");
        const siblings = typeof localServiceRegistry.servicesForWorker === "function"
          ? localServiceRegistry.servicesForWorker(service.projectId, service.workerId)
          : [service];
        const snapshot = typeof engineApi.getSnapshot === "function" ? engineApi.getSnapshot(service.workerId) : null;
        return {
          result: {
            workerId: service.workerId,
            workerName: service.workerName,
            workerStatus: snapshot?.status || "unknown",
            workerIsAlive: Boolean(snapshot?.isAlive),
            workerExists: Boolean(snapshot),
            services: siblings.map(item => ({ id: item.id, url: item.url, port: item.port, state: item.state }))
          }
        };
      }
      // Read-only port ownership. It proves who holds a port; it never
      // terminates anything it did not start.
      case "services.inspectPort": {
        if (!portInspector) throw new ProtocolError("UNAVAILABLE", "port inspection is not available");
        const port = params?.port;
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new ProtocolError("INVALID_PARAMS", "port must be an integer between 1 and 65535");
        }
        return { result: await portInspector.inspect(port) };
      }
      // Agent CLIs authenticate themselves and never pass through this app, so
      // their usage is read from the transcripts they leave on disk. Triggered
      // explicitly rather than polled.
      case "usage.import": {
        if (!importCliUsage) throw new ProtocolError("UNAVAILABLE", "local CLI usage import is not available");
        return { result: await importCliUsage() };
      }
      case "usage.query": {
        if (!usageLedger) {
          return {
            result: {
              available: false,
              totals: { callCount: 0, totalTokens: 0, totalCost: 0, breakdown: null, byModel: {} },
              records: []
            }
          };
        }
        const totals = usageLedger.getAggregate(params);
        const records = usageLedger.query(params);
        return { result: { available: true, totals, records } };
      }
      case "terminal.window.list": {
        if (!terminalWindowManager) return { result: { detached: [], max: 3, available: false } };
        return {
          result: {
            detached: terminalWindowManager.listDetached(),
            max: terminalWindowManager.maxWindows ?? 3,
            available: true
          }
        };
      }
      case "terminal.window.detach": {
        const workerId = requireString(params, "workerId");
        if (!terminalWindowManager) throw new ProtocolError("UNAVAILABLE", "pop-out terminal windows not supported");
        // The pane the terminal came from is reserved so Recall returns it to
        // the exact slot and split it left, not to a deterministic fallback.
        const snapshot = typeof engineApi.getSnapshot === "function" ? engineApi.getSnapshot(workerId) : null;
        if (!snapshot) throw new ProtocolError("NOT_FOUND", "That terminal is not in this project any more.");
        if (!terminalWindowManager.isDetached(workerId) && !terminalWindowManager.canDetach()) {
          throw new ProtocolError("LIMIT", "Three terminals are already popped out. Recall one to open another.");
        }
        try {
          return {
            result: await terminalWindowManager.detach(workerId, {
              slotId: typeof params?.slotId === "string" ? params.slotId : null,
              workerName: snapshot.name || workerId
            })
          };
        } catch (error) {
          throw new ProtocolError("UNAVAILABLE", error instanceof Error ? error.message : String(error));
        }
      }
      case "terminal.window.recall": {
        const workerId = requireString(params, "workerId");
        if (!terminalWindowManager) throw new ProtocolError("UNAVAILABLE", "pop-out terminal windows not supported");
        return { result: { recalled: await terminalWindowManager.recall(workerId) } };
      }
      case "terminal.window.focus": {
        const workerId = requireString(params, "workerId");
        if (!terminalWindowManager) throw new ProtocolError("UNAVAILABLE", "pop-out terminal windows not supported");
        return { result: { focused: terminalWindowManager.focus(workerId) } };
      }
      // The in-app browser. Every entry point resolves the address through the
      // same loopback policy `services.open` states, and the view itself
      // re-checks each navigation, so a page cannot walk off the machine even
      // if a caller here were wrong.
      case "workspace.browser.open": {
        if (!workspaceBrowser) throw new ProtocolError("UNAVAILABLE", "the OUTARCH browser is not available on this connection");
        const url = params?.url === undefined || params?.url === null ? null : assertPreviewableUrl(params.url);
        return { result: workspaceBrowser.open({ url, bounds: params?.bounds || null }) };
      }
      case "workspace.browser.bounds": {
        if (!workspaceBrowser) throw new ProtocolError("UNAVAILABLE", "the OUTARCH browser is not available on this connection");
        return { result: workspaceBrowser.setBounds(params?.bounds || null) };
      }
      case "workspace.browser.command": {
        if (!workspaceBrowser) throw new ProtocolError("UNAVAILABLE", "the OUTARCH browser is not available on this connection");
        const action = requireString(params, "action");
        if (!["back", "forward", "reload", "stop", "close"].includes(action)) {
          throw new ProtocolError("INVALID_PARAMS", "unknown browser action");
        }
        return { result: action === "close" ? workspaceBrowser.close() : workspaceBrowser.command(action) };
      }
      case "workspace.browser.state": {
        if (!workspaceBrowser) return { result: { available: false, open: false, url: "", title: "", loading: false, error: null, canGoBack: false, canGoForward: false } };
        return { result: workspaceBrowser.state() };
      }
      case "recovery.inspect": {
        // The boot report is what the gate read *before* the engine opened.
        // Re-reading the journal here would describe this session instead,
        // because opening one overwrites the record being asked about.
        if (recoveryBoot) {
          return {
            result: {
              ...(recoveryBoot.getReport?.() || { cleanShutdown: true, recoveryRequired: false, workers: [] }),
              launchesDeferred: recoveryBoot.isDeferred?.() === true
            }
          };
        }
        if (!sessionRecoveryService) return { result: { records: [] } };
        const sessions = typeof engineApi.list === "function" ? engineApi.list() : [];
        return { result: sessionRecoveryService.inspect(params?.projectId || "default", sessions) };
      }
      // Ends the recovery deferral and starts the workers whose saved autoStart
      // would have launched them at load. Nothing else is resumed implicitly.
      case "recovery.resume": {
        if (!recoveryBoot || typeof recoveryBoot.resume !== "function") {
          throw new ProtocolError("UNAVAILABLE", "there is no deferred launch to resume");
        }
        return { result: { started: await recoveryBoot.resume() } };
      }
      case "recovery.propose": {
        if (!sessionRecoveryService) return { result: { plan: [] } };
        const sessions = typeof engineApi.list === "function" ? engineApi.list() : [];
        return { result: sessionRecoveryService.propose(params?.projectId || "default", params?.selectedWorkerIds || [], sessions) };
      }
      // Which terminals are running an AI agent right now, and what each one is
      // doing. Classification is evidence-based — a shell that launches Claude
      // becomes an agent, and stops being one when it exits.
      case "agents.activity": {
        if (!agentActivityService) return { result: { activities: [], available: false } };
        return { result: { activities: agentActivityService.listActivities(), available: true } };
      }
      case "missionAi.conversation.send": {
        if (!missionAiConversation) throw new ProtocolError("UNAVAILABLE", "Mission AI conversation service is not available");
        return { result: await missionAiConversation.send(params) };
      }
      case "ai.status": {
        if (!aiAssistant) throw new ProtocolError("UNAVAILABLE", "the assistant is not available on this connection");
        return { result: aiAssistant.status() };
      }
      case "ai.selection.set": {
        if (!aiAssistant) throw new ProtocolError("UNAVAILABLE", "the assistant is not available on this connection");
        const surface = requireString(params, "surface");
        if (!isPlainObject(params?.target)) throw new ProtocolError("INVALID_PARAMS", "target must be an object");
        return { result: aiAssistant.setSelection(surface, params.target) };
      }
      // The key crosses from the renderer exactly once, here, and is never
      // returned: the result carries the saved record, which has no key in it.
      // Reads the shape of a key being pasted. Nothing is sent to any provider.
      case "ai.byok.detect": {
        if (!aiAssistant) throw new ProtocolError("UNAVAILABLE", "the assistant is not available on this connection");
        return { result: aiAssistant.detectKey(typeof params?.apiKey === "string" ? params.apiKey.slice(0, 512) : "") };
      }
      case "ai.byok.add": {
        if (!aiAssistant) throw new ProtocolError("UNAVAILABLE", "the assistant is not available on this connection");
        const apiKey = requireString(params, "apiKey");
        return { result: await aiAssistant.addKey({ apiKey, provider: typeof params?.provider === "string" ? params.provider : null, label: typeof params?.label === "string" ? params.label : "", baseUrl: typeof params?.baseUrl === "string" && params.baseUrl ? params.baseUrl : null }) };
      }
      case "ai.byok.remove": {
        if (!aiAssistant) throw new ProtocolError("UNAVAILABLE", "the assistant is not available on this connection");
        requireConfirmation("ai.byok.remove", params);
        return { result: aiAssistant.removeKey(requireString(params, "keyId")) };
      }
      case "ai.byok.refresh": {
        if (!aiAssistant) throw new ProtocolError("UNAVAILABLE", "the assistant is not available on this connection");
        return { result: await aiAssistant.refreshModels(typeof params?.keyId === "string" && params.keyId ? params.keyId : null) };
      }
      case "ai.chat.send": {
        if (!aiAssistant) throw new ProtocolError("UNAVAILABLE", "the assistant is not available on this connection");
        return { result: await aiAssistant.send({ conversationId: requireString(params, "conversationId"), surface: params?.surface === "workspace" ? "workspace" : "missionAi", text: requireString(params, "text"), focusWorkerId: typeof params?.focusWorkerId === "string" ? params.focusWorkerId : null }) };
      }
      case "ai.chat.resolve": {
        if (!aiAssistant) throw new ProtocolError("UNAVAILABLE", "the assistant is not available on this connection");
        return { result: await aiAssistant.resolve({ conversationId: requireString(params, "conversationId"), decision: requireString(params, "decision") }) };
      }
      case "ai.chat.history": {
        if (!aiAssistant) return { result: { conversationId: String(params?.conversationId || ""), messages: [], pending: null, busy: false } };
        return { result: aiAssistant.history(requireString(params, "conversationId")) };
      }
      case "ai.chat.clear": {
        if (!aiAssistant) throw new ProtocolError("UNAVAILABLE", "the assistant is not available on this connection");
        return { result: aiAssistant.clear(requireString(params, "conversationId")) };
      }
      case "ai.chat.cancel": {
        if (!aiAssistant) throw new ProtocolError("UNAVAILABLE", "the assistant is not available on this connection");
        return { result: aiAssistant.cancel(requireString(params, "conversationId")) };
      }
      case "ai.chat.autoApprove": {
        if (!aiAssistant) throw new ProtocolError("UNAVAILABLE", "the assistant is not available on this connection");
        return { result: aiAssistant.setAutoApprove(requireString(params, "conversationId"), params?.enabled === true) };
      }
      case "missionAi.conversation.history": {
        if (!missionAiConversation) return { result: { history: [] } };
        return { result: { history: missionAiConversation.getHistory(params?.conversationId) } };
      }
      case "system.shutdown": {
        if (typeof onShutdown !== "function") {
          throw new ProtocolError("UNAVAILABLE", "shutdown is not available on this connection");
        }
        const result = await onShutdown();
        if (result && result.ok === false) {
          throw new ProtocolError("SHUTDOWN_FAILED", result.error || "shutdown failed");
        }
        return { result: result === undefined ? { accepted: true } : result };
      }
      default:
        throw new ProtocolError("METHOD_NOT_FOUND", `unknown protocol method: ${method}`);
    }
  }

  async function handle(input) {
    let request;
    let response;
    let afterSend = null;
    try {
      if (disposed) throw new ProtocolError("CONNECTION_CLOSED", "protocol connection is closed");
      request = decodeRequest(input);
      const dispatched = await dispatchMethod(request.method, request.params);
      if (confirmationIsRequired(request.method, request.params)) {
        recordConfirmation("completed", request.method);
      }
      response = {
        version: PROTOCOL_VERSION,
        id: request.id,
        ok: true,
        result: dispatched.result
      };
      afterSend = dispatched.afterSend || null;
    } catch (error) {
      const protocolError = error instanceof ProtocolError
        ? error
        : new ProtocolError("INTERNAL_ERROR", error instanceof Error ? error.message : String(error));
      response = {
        version: PROTOCOL_VERSION,
        id: request?.id || requestIdFrom(input),
        ok: false,
        error: { code: protocolError.code, message: protocolError.message, ...(protocolError.details ? { plan: protocolError.details } : null) }
      };
    }

    safeSend(response);
    afterSend?.();
    return response;
  }

  function dispose() {
    if (disposed) return false;
    try { unsubscribeEvents?.(); } catch (error) { /* Best effort. */ }
    try { unsubscribeVSCode?.(); } catch (error) { /* Best effort. */ }
    try { unsubscribeMcp?.(); } catch (error) { /* Best effort. */ }
    try { unsubscribeMobile?.(); } catch (error) { /* Best effort. */ }
    try { unsubscribeNotifications?.(); } catch (error) { /* Best effort. */ }
    for (const streamId of [...terminalStreams.keys()]) closeTerminal(streamId);
    pendingConfirmations.clear();
    eventQueue = [];
    disposed = true;
    return true;
  }

  return { handle, dispose };
}

module.exports = {
  PROTOCOL_VERSION,
  METHODS,
  MAX_REQUEST_BYTES,
  MAX_TERMINAL_INPUT_BYTES,
  MAX_TERMINAL_REPLAY_BYTES,
  MAX_TERMINAL_QUEUE_BYTES,
  MAX_TERMINAL_BATCH_BYTES,
  MAX_EVENT_QUEUE,
  MAX_TERMINAL_DIMENSION,
  CONFIRMATION_TTL_MS,
  MAX_PENDING_CONFIRMATIONS,
  ProtocolError,
  createProtocolConnection
};
