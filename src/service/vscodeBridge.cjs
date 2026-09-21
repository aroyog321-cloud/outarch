const crypto = require("node:crypto");
const EventEmitter = require("node:events");
const net = require("node:net");
const path = require("node:path");
const { redactText } = require("./contextSanitizer.cjs");

const VSCODE_BRIDGE_PROTOCOL_VERSION = 1;
const MAX_BRIDGE_MESSAGE_BYTES = 64 * 1024;
const MAX_DIAGNOSTICS = 50;
const MAX_TASKS = 20;
const MAX_TERMINALS = 32;
const VSCODE_AUDIT_LIMIT = 50;
const HANDSHAKE_TTL_MS = 60 * 1000;
const SOCKET_HANDSHAKE_TIMEOUT_MS = 10 * 1000;
const COMMAND_TIMEOUT_MS = 5 * 1000;
const MAX_TERMINAL_INPUT_BYTES = 4096;
const ALLOWED_CAPABILITIES = Object.freeze([
  "editor.activeFile.read",
  "diagnostics.summary.read",
  "git.summary.read",
  "tasks.status.read",
  "terminals.identity.read",
  "terminals.activity.read",
  "terminals.manage",
  "terminals.input.write",
  "editor.open"
]);
const CAPABILITY_BY_MESSAGE = Object.freeze({
  "editor:state": "editor.activeFile.read",
  diagnostics: "diagnostics.summary.read",
  "git:state": "git.summary.read",
  "task:state": "tasks.status.read",
  "terminals:state": "terminals.identity.read",
  "terminal:output": "terminals.activity.read"
});

function stripAnsi(text) {
  if (typeof text !== "string" || !text) return "";
  return text
    .replace(/\x1b\][^\x07\x1b\r\n]*(?:\x07|\x1b\\|[\r\n]|$)/g, "")
    .replace(/\x1b[\(\)][AB012UK]/g, "")
    .replace(/\x1b\[[?><=0-9;]*[ -/]*[@-~]/g, "")
    .replace(/\[[?><=][0-9;]*[a-zA-Z]/g, "")
    .replace(/\([AB012UK]/g, "")
    .replace(/\](?:633|133|1337);[^\r\n]*/g, "")
    .replace(/\x1b[@-Z\\-_]|[\x80-\x9A\x9C-\x9F]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedText(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function boundedInteger(value, minimum, maximum, fallback = 0) {
  return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function pathApi(platform) {
  return platform === "win32" ? path.win32 : path;
}

function canonicalPath(value, platform = process.platform) {
  const resolved = pathApi(platform).resolve(String(value || ""));
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function relativeWorkspaceFile(root, value, platform = process.platform) {
  if (typeof root !== "string" || !root || typeof value !== "string" || !value || value.length > 1024) return null;
  const paths = pathApi(platform);
  const absolute = paths.isAbsolute(value) ? paths.resolve(value) : paths.resolve(root, value);
  const relative = paths.relative(root, absolute);
  if (!relative || relative === "." || relative.startsWith("..") || paths.isAbsolute(relative)) return null;
  if (platform === "win32" && !canonicalPath(absolute, platform).startsWith(`${canonicalPath(root, platform)}${paths.sep}`)) return null;
  return relative.split(paths.sep).join("/").slice(0, 1024);
}

function projectIdFor(workspace, platform = process.platform) {
  return crypto.createHash("sha256").update(canonicalPath(workspace.directory, platform)).digest("hex").slice(0, 20);
}

function tokenDigest(token) {
  return crypto.createHash("sha256").update(String(token)).digest();
}

function safeEqual(left, right) {
  const leftDigest = tokenDigest(left);
  const rightDigest = Buffer.isBuffer(right) ? right : tokenDigest(right);
  return leftDigest.length === rightDigest.length && crypto.timingSafeEqual(leftDigest, rightDigest);
}

function socketIsLoopback(socket) {
  const address = String(socket.remoteAddress || "").toLowerCase();
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function publicError(error, fallback) {
  return boundedText(error instanceof Error ? error.message : error, 240) || fallback;
}

class VSCodeBridge extends EventEmitter {
  constructor(options = {}) {
    super();
    this.createServer = options.createServer || (listener => net.createServer(listener));
    this.openExternal = typeof options.openExternal === "function" ? options.openExternal : async () => false;
    this.getWorkspace = typeof options.getWorkspace === "function" ? options.getWorkspace : () => null;
    this.now = options.now || Date.now;
    this.randomBytes = options.randomBytes || crypto.randomBytes;
    this.platform = options.platform || process.platform;
    this.handshakeTtlMs = Number.isInteger(options.handshakeTtlMs) ? Math.max(1000, options.handshakeTtlMs) : HANDSHAKE_TTL_MS;
    this.socketHandshakeTimeoutMs = Number.isInteger(options.socketHandshakeTimeoutMs) ? Math.max(250, options.socketHandshakeTimeoutMs) : SOCKET_HANDSHAKE_TIMEOUT_MS;
    this.server = null;
    this.port = null;
    this.startPromise = null;
    this.client = null;
    this.pendingCommands = new Map();
    this.pending = null;
    this.lastError = null;
    this.editor = null;
    this.diagnostics = { errors: 0, warnings: 0, information: 0, hints: 0, items: [] };
    this.git = null;
    this.tasks = [];
    this.terminals = [];
    this.terminalLogs = new Map();
    this.lastSyncAt = null;
    // T115 - the same audit depth MCP and Mobile already had.
    // Connection metadata only: no file content, no terminal input, no editor
    // text ever reaches this ring, and the recorded paths are the workspace's
    // own relative ones the status already publishes.
    this.audit = [];
  }

  record(kind, outcome, detail = {}) {
    this.audit.push({
      id: `vscode-audit-${this.audit.length + 1}-${this.now()}`,
      kind,
      outcome,
      at: this.now(),
      ...detail
    });
    if (this.audit.length > VSCODE_AUDIT_LIMIT) this.audit.splice(0, this.audit.length - VSCODE_AUDIT_LIMIT);
  }

  listAudit(limit = 50) {
    const bounded = Number.isInteger(limit) && limit > 0 ? Math.min(limit, VSCODE_AUDIT_LIMIT) : VSCODE_AUDIT_LIMIT;
    return this.audit.slice(-bounded).reverse().map(item => ({ ...item }));
  }

  subscribe(callback) {
    if (typeof callback !== "function") throw new TypeError("VS Code Bridge subscriber must be a function");
    this.on("status", callback);
    return () => this.off("status", callback);
  }

  async start() {
    if (this.server?.listening) return this.status();
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise((resolve, reject) => {
      const server = this.createServer(socket => this.#accept(socket));
      this.server = server;
      const onError = error => {
        server.off?.("listening", onListening);
        this.server = null;
        this.port = null;
        this.lastError = publicError(error, "VS Code Bridge could not bind to loopback");
        this.record("transport", "bind-failed");
        reject(error);
      };
      const onListening = () => {
        server.off?.("error", onError);
        const address = server.address();
        this.port = typeof address === "object" && address ? address.port : null;
        server.on?.("error", error => {
          this.lastError = publicError(error, "VS Code Bridge transport error");
          this.record("transport", "error");
          this.#emitStatus();
        });
        server.unref?.();
        this.lastError = null;
        resolve(this.status());
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(0, "127.0.0.1");
    }).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  async launch(options = {}) {
    const workspace = this.#workspace();
    await this.start();
    const token = this.randomBytes(32).toString("base64url");
    const expiresAt = this.now() + this.handshakeTtlMs;
    this.pending = {
      tokenDigest: tokenDigest(token),
      expiresAt,
      projectId: projectIdFor(workspace, this.platform),
      command: this.#normalizeCommand(options.command, workspace)
    };
    const uri = new URL("vscode://mission-control.bridge/connect");
    uri.searchParams.set("port", String(this.port));
    uri.searchParams.set("token", token);
    uri.searchParams.set("project", this.pending.projectId);
    try {
      const launched = await this.openExternal(uri.toString());
      if (launched === false) throw new Error("VS Code did not accept the bridge launch URI");
    } catch (error) {
      this.pending = null;
      this.lastError = publicError(error, "VS Code could not be opened");
      this.record("launch", "failed");
      this.#emitStatus();
      throw new Error(this.lastError);
    }
    this.lastError = null;
    this.#emitStatus();
    return { launched: true, awaitingHandshake: true, expiresAt, status: this.status() };
  }

  async openFile(params = {}) {
    const workspace = this.#workspace();
    const command = this.#normalizeCommand({
      type: "open-file",
      relativePath: params.relativePath,
      line: params.line,
      column: params.column
    }, workspace);
    if (!command) throw new TypeError("relativePath must identify a file inside the active project");
    if (this.client?.authenticated) {
      if (!this.#hasCapability("editor.open")) throw new Error("The connected VS Code extension did not grant editor.open");
      if (!this.#send(this.client.socket, { ...command, type: "command:open-file" })) throw new Error("VS Code Bridge could not send the editor command");
      return { sent: true, launched: false };
    }
    const result = await this.launch({ command });
    return { sent: false, launched: true, awaitingHandshake: result.awaitingHandshake };
  }

  async openProblems() {
    this.#workspace();
    const command = { type: "open-problems" };
    if (this.client?.authenticated) {
      if (!this.#hasCapability("editor.open")) throw new Error("The connected VS Code extension did not grant editor.open");
      if (!this.#send(this.client.socket, { type: "command:open-problems" })) throw new Error("VS Code Bridge could not send the editor command");
      return { sent: true, launched: false };
    }
    const result = await this.launch({ command });
    return { sent: false, launched: true, awaitingHandshake: result.awaitingHandshake };
  }

  async createManagedTerminal(params = {}) {
    const workspace = this.#workspace();
    const name = boundedText(params.name, 80) || "OUTARCH";
    const requestedCwd = typeof params.cwd === "string" ? params.cwd.trim() : ".";
    const cwd = !requestedCwd || requestedCwd === "."
      ? "."
      : relativeWorkspaceFile(workspace.directory, requestedCwd, this.platform);
    if (!cwd) throw new TypeError("cwd must identify a directory inside the active project");
    return this.#requestCommand("command:terminal-create", "terminals.manage", { name, cwd });
  }

  async writeManagedTerminal(params = {}) {
    const terminalId = this.#terminalId(params.terminalId);
    if (typeof params.input !== "string" || !params.input || params.input.includes("\0") || /[\r\n]/.test(params.input)) {
      throw new TypeError("input must be one non-empty terminal command");
    }
    if (Buffer.byteLength(params.input, "utf8") > MAX_TERMINAL_INPUT_BYTES) {
      throw new TypeError(`input must be at most ${MAX_TERMINAL_INPUT_BYTES} bytes`);
    }
    const sanitized = redactText(params.input, { maxLength: MAX_TERMINAL_INPUT_BYTES });
    if (sanitized.redactions) throw new TypeError("terminal input appears to contain a secret and was blocked");

    let logs = this.terminalLogs.get(terminalId);
    if (!logs) {
      logs = [];
      this.terminalLogs.set(terminalId, logs);
    }
    logs.push({
      type: "input",
      text: params.input,
      timestamp: this.now()
    });
    if (logs.length > 200) logs.splice(0, logs.length - 200);
    this.#emitStatus();

    return this.#requestCommand("command:terminal-write", "terminals.input.write", {
      terminalId,
      input: params.input,
      addNewLine: params.addNewLine !== false
    });
  }

  async focusManagedTerminal(params = {}) {
    return this.#requestCommand("command:terminal-focus", "terminals.manage", { terminalId: this.#terminalId(params.terminalId) });
  }

  async closeManagedTerminal(params = {}) {
    return this.#requestCommand("command:terminal-close", "terminals.manage", { terminalId: this.#terminalId(params.terminalId) });
  }

  workspaceChanged() {
    this.pending = null;
    this.disconnect("workspace-changed");
    this.editor = null;
    this.diagnostics = { errors: 0, warnings: 0, information: 0, hints: 0, items: [] };
    this.git = null;
    this.tasks = [];
    this.terminals = [];
    this.terminalLogs.clear();
    this.lastSyncAt = null;
    this.#emitStatus();
  }

  disconnect(reason = "requested") {
    const client = this.client;
    this.client = null;
    this.#rejectPendingCommands("VS Code Bridge disconnected before the command completed");
    this.terminalLogs.clear();
    if (!client) return false;
    this.record("connection", "disconnected", { capability: boundedText(reason, 80) || "requested" });
    try { this.#send(client.socket, { type: "disconnect", reason: boundedText(reason, 80) || "requested" }); } catch { /* Best effort. */ }
    client.socket.destroy();
    this.#emitStatus();
    return true;
  }

  status() {
    const pending = this.pending && this.pending.expiresAt > this.now();
    return {
      id: "vscode",
      endpoint: this.port ? `127.0.0.1:${this.port}` : null,
      auditCount: this.audit.length,
      service: this.server?.listening ? "listening" : "stopped",
      connected: Boolean(this.client?.authenticated),
      awaitingHandshake: Boolean(pending),
      connection: this.client?.authenticated ? {
        clientId: this.client.clientId,
        extensionVersion: this.client.extensionVersion,
        connectedAt: this.client.connectedAt,
        capabilities: [...this.client.capabilities]
      } : null,
      permissions: [...ALLOWED_CAPABILITIES],
      editor: this.editor ? { ...this.editor } : null,
      diagnostics: { ...this.diagnostics, items: this.diagnostics.items.map(item => ({ ...item })) },
      git: this.git ? { ...this.git } : null,
      tasks: this.tasks.map(task => ({ ...task })),
      terminals: this.terminals.map(terminal => ({
        ...terminal,
        logs: (this.terminalLogs.get(terminal.id) || []).slice(-100)
      })),
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError
    };
  }

  dispose() {
    this.pending = null;
    this.disconnect("shutdown");
    const server = this.server;
    this.server = null;
    this.port = null;
    if (server) {
      try { server.close(); } catch { /* Best effort. */ }
    }
    this.removeAllListeners();
  }

  #terminalId(value) {
    const terminalId = boundedText(value, 100);
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(terminalId)) throw new TypeError("terminalId is invalid");
    return terminalId;
  }

  #requestCommand(type, capability, payload) {
    this.#workspace();
    if (!this.client?.authenticated) throw new Error("Connect VS Code before controlling a managed terminal");
    if (!this.#hasCapability(capability)) throw new Error(`The connected VS Code extension did not grant ${capability}`);
    const requestId = this.randomBytes(18).toString("base64url");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new Error("VS Code did not confirm the terminal command in time"));
      }, COMMAND_TIMEOUT_MS);
      timer.unref?.();
      this.pendingCommands.set(requestId, { resolve, reject, timer });
      if (!this.#send(this.client.socket, { type, requestId, ...payload })) {
        clearTimeout(timer);
        this.pendingCommands.delete(requestId);
        reject(new Error("VS Code Bridge could not send the terminal command"));
      }
    });
  }

  #rejectPendingCommands(message) {
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pendingCommands.clear();
  }

  #workspace() {
    const workspace = this.getWorkspace();
    if (!workspace?.persistent || typeof workspace.directory !== "string" || !workspace.directory) {
      throw new Error("Open a persistent project before connecting VS Code");
    }
    return workspace;
  }

  #normalizeCommand(command, workspace) {
    if (!isPlainObject(command)) return null;
    if (command.type === "open-problems") return { type: "open-problems" };
    if (command.type !== "open-file") return null;
    const relativePath = relativeWorkspaceFile(workspace.directory, command.relativePath, this.platform);
    if (!relativePath) return null;
    return {
      type: "open-file",
      relativePath,
      line: boundedInteger(command.line, 1, 10_000_000, 1),
      column: boundedInteger(command.column, 1, 100_000, 1)
    };
  }

  #accept(socket) {
    if (!socketIsLoopback(socket)) {
      socket.destroy();
      return;
    }
    socket.setEncoding("utf8");
    socket.setNoDelay?.(true);
    let buffer = "";
    let authenticated = false;
    const timer = setTimeout(() => {
      if (!authenticated) socket.destroy();
    }, this.socketHandshakeTimeoutMs);
    timer.unref?.();
    socket.on("data", chunk => {
      buffer += String(chunk);
      if (Buffer.byteLength(buffer, "utf8") > MAX_BRIDGE_MESSAGE_BYTES) {
        socket.destroy();
        return;
      }
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch { socket.destroy(); return; }
        if (!authenticated) {
          authenticated = this.#handshake(socket, message);
          if (!authenticated) { socket.destroy(); return; }
          clearTimeout(timer);
        } else {
          this.#synchronize(message);
        }
      }
    });
    socket.on("close", () => {
      clearTimeout(timer);
      if (this.client?.socket === socket) {
        this.client = null;
        this.#rejectPendingCommands("VS Code Bridge connection closed before the command completed");
        this.#emitStatus();
      }
    });
    socket.on("error", () => {});
  }

  #handshake(socket, message) {
    const pending = this.pending;
    if (!pending || pending.expiresAt <= this.now()) {
      this.pending = null;
      return false;
    }
    if (!isPlainObject(message) || message.type !== "hello" || message.protocolVersion !== VSCODE_BRIDGE_PROTOCOL_VERSION) return false;
    if (typeof message.token !== "string" || !safeEqual(message.token, pending.tokenDigest)) return false;
    let workspace;
    try { workspace = this.#workspace(); } catch { return false; }
    if (projectIdFor(workspace, this.platform) !== pending.projectId) return false;
    if (canonicalPath(message.workspacePath, this.platform) !== canonicalPath(workspace.directory, this.platform)) return false;
    const capabilities = Array.isArray(message.capabilities)
      ? [...new Set(message.capabilities.filter(value => ALLOWED_CAPABILITIES.includes(value)))].slice(0, ALLOWED_CAPABILITIES.length)
      : [];
    this.disconnect("replaced");
    this.pending = null;
    this.record("handshake", "accepted", { capability: capabilities.join(",") || "none" });
    this.client = {
      socket,
      authenticated: true,
      clientId: boundedText(message.clientId, 80) || "vscode",
      extensionVersion: boundedText(message.extensionVersion, 32) || "unknown",
      connectedAt: this.now(),
      capabilities
    };
    this.#send(socket, {
      type: "hello:ack",
      protocolVersion: VSCODE_BRIDGE_PROTOCOL_VERSION,
      project: { id: pending.projectId, name: boundedText(workspace.name, 80) || "Project" },
      permissions: capabilities,
      limits: { maxMessageBytes: MAX_BRIDGE_MESSAGE_BYTES, maxDiagnostics: MAX_DIAGNOSTICS }
    });
    if (pending.command && this.#hasCapability("editor.open")) {
      const type = pending.command.type === "open-file" ? "command:open-file" : "command:open-problems";
      this.#send(socket, { ...pending.command, type });
    } else if (pending.command) {
      this.lastError = "The connected VS Code extension did not grant editor.open";
    }
    this.#emitStatus();
    return true;
  }

  #synchronize(message) {
    if (!isPlainObject(message) || !this.client?.authenticated) return;
    if (message.type === "ping") {
      this.#send(this.client.socket, { type: "pong", at: this.now() });
      return;
    }
    if (message.type === "command:result") {
      const requestId = boundedText(message.requestId, 80);
      const pending = this.pendingCommands.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pendingCommands.delete(requestId);
      const terminalId = boundedText(message.terminalId, 100);
      if (message.ok === true) pending.resolve({
        ok: true,
        terminalId: /^[A-Za-z0-9_-]{1,100}$/.test(terminalId) ? terminalId : null
      });
      else pending.reject(new Error(boundedText(message.error, 240) || "VS Code rejected the terminal command"));
      return;
    }
    const requiredCapability = CAPABILITY_BY_MESSAGE[message.type];
    if (!requiredCapability || !this.#hasCapability(requiredCapability)) return;
    let workspace;
    try { workspace = this.#workspace(); } catch { this.workspaceChanged(); return; }
    if (message.type === "editor:state") {
      const relativePath = message.relativePath ? relativeWorkspaceFile(workspace.directory, message.relativePath, this.platform) : null;
      this.editor = relativePath ? {
        relativePath,
        line: boundedInteger(message.line, 1, 10_000_000, 1),
        column: boundedInteger(message.column, 1, 100_000, 1),
        languageId: boundedText(message.languageId, 64) || null,
        dirty: message.dirty === true,
        savedAt: Number.isInteger(message.savedAt) ? message.savedAt : null
      } : null;
    } else if (message.type === "diagnostics") {
      const items = Array.isArray(message.items) ? message.items.slice(0, MAX_DIAGNOSTICS).map(item => {
        const relativePath = relativeWorkspaceFile(workspace.directory, item?.relativePath, this.platform);
        if (!relativePath) return null;
        return {
          relativePath,
          line: boundedInteger(item.line, 1, 10_000_000, 1),
          severity: ["error", "warning", "information", "hint"].includes(item.severity) ? item.severity : "information",
          code: boundedText(item.code, 80) || null,
          message: boundedText(item.message, 240)
        };
      }).filter(Boolean) : [];
      this.diagnostics = {
        errors: boundedInteger(message.errors, 0, 100_000),
        warnings: boundedInteger(message.warnings, 0, 100_000),
        information: boundedInteger(message.information, 0, 100_000),
        hints: boundedInteger(message.hints, 0, 100_000),
        items
      };
    } else if (message.type === "git:state") {
      this.git = {
        branch: boundedText(message.branch, 160) || null,
        changedPaths: boundedInteger(message.changedPaths, 0, 100_000),
        ahead: boundedInteger(message.ahead, 0, 100_000),
        behind: boundedInteger(message.behind, 0, 100_000),
        clean: message.clean === true
      };
    } else if (message.type === "task:state") {
      const task = {
        name: boundedText(message.name, 120) || "VS Code task",
        state: ["started", "succeeded", "failed", "ended"].includes(message.state) ? message.state : "ended",
        exitCode: Number.isInteger(message.exitCode) ? message.exitCode : null,
        at: this.now()
      };
      this.tasks = [task, ...this.tasks].slice(0, MAX_TASKS);
    } else if (message.type === "terminals:state") {
      const canReadActivity = this.#hasCapability("terminals.activity.read");
      this.terminals = Array.isArray(message.terminals) ? message.terminals.slice(0, MAX_TERMINALS).map(item => {
        const ownership = item?.ownership === "mission-control-managed" ? "mission-control-managed" : "vscode-owned";
        const command = canReadActivity ? redactText(item?.currentCommand || "", { maxLength: 240 }) : null;
        return {
          id: /^[A-Za-z0-9_-]{1,100}$/.test(String(item?.id || "")) ? String(item.id) : null,
          name: boundedText(item?.name, 120) || "Terminal",
          state: item?.state === "closed" ? "closed" : "open",
          ownership,
          controllable: ownership === "mission-control-managed",
          active: item?.active === true,
          shellIntegration: canReadActivity && item?.shellIntegration === true,
          currentCommand: canReadActivity && command?.value ? (command.redactions ? "[command hidden: possible secret]" : command.value) : null,
          commandState: canReadActivity && ["idle", "running", "succeeded", "failed"].includes(item?.commandState) ? item.commandState : "idle",
          cwd: canReadActivity ? (boundedText(item?.cwd, 1024) || null) : null
        };
      }).filter(item => item.id) : [];
    } else if (message.type === "terminal:output") {
      const terminalId = boundedText(message.terminalId, 100);
      if (terminalId && /^[A-Za-z0-9_-]{1,100}$/.test(terminalId)) {
        let logs = this.terminalLogs.get(terminalId);
        if (!logs) {
          logs = [];
          this.terminalLogs.set(terminalId, logs);
        }
        if (typeof message.input === "string" && message.input.trim()) {
          const rawInput = stripAnsi(message.input.trim());
          if (rawInput) {
            const sanitized = redactText(rawInput, { maxLength: 240 });
            const last = logs[logs.length - 1];
            if (!last || last.type !== "input" || last.text !== sanitized.value) {
              logs.push({
                type: "input",
                text: sanitized.redactions ? "[command hidden: possible secret]" : sanitized.value,
                timestamp: this.now()
              });
            }
          }
        }
        if (typeof message.data === "string" && message.data) {
          const clean = stripAnsi(message.data);
          const chunks = clean.split("\n");
          for (let i = 0; i < chunks.length; i++) {
            const line = chunks[i].trimEnd();
            if (!line.trim()) continue;
            const sanitized = redactText(line, { maxLength: 1024 });
            logs.push({
              type: "output",
              text: sanitized.redactions ? "[output redacted: secret pattern]" : sanitized.value,
              timestamp: this.now()
            });
          }
        }
        if (typeof message.state === "string" && message.state !== "running" && message.exitCode !== undefined) {
          logs.push({
            type: "system",
            text: `[Process exited with code ${message.exitCode}]`,
            exitCode: message.exitCode,
            timestamp: this.now()
          });
        }
        if (logs.length > 200) logs.splice(0, logs.length - 200);
      }
    } else {
      return;
    }
    this.lastSyncAt = this.now();
    this.#emitStatus();
  }

  #send(socket, message) {
    if (!socket || socket.destroyed) return false;
    const data = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(data, "utf8") > MAX_BRIDGE_MESSAGE_BYTES) return false;
    socket.write(data);
    return true;
  }

  #hasCapability(capability) {
    return Boolean(this.client?.authenticated && this.client.capabilities.includes(capability));
  }

  #emitStatus() {
    const value = this.status();
    for (const listener of this.listeners("status")) {
      try { listener(value); } catch { /* Subscriber isolation. */ }
    }
  }
}

module.exports = {
  ALLOWED_CAPABILITIES,
  CAPABILITY_BY_MESSAGE,
  HANDSHAKE_TTL_MS,
  MAX_BRIDGE_MESSAGE_BYTES,
  MAX_DIAGNOSTICS,
  MAX_TASKS,
  MAX_TERMINALS,
  MAX_TERMINAL_INPUT_BYTES,
  SOCKET_HANDSHAKE_TIMEOUT_MS,
  VSCODE_BRIDGE_PROTOCOL_VERSION,
  VSCodeBridge,
  canonicalPath,
  relativeWorkspaceFile
};
