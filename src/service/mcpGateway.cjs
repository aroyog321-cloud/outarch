"use strict";

const crypto = require("node:crypto");
const EventEmitter = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { redactText } = require("./contextSanitizer.cjs");
const { ASSETS: BRAND_ASSETS } = require("../brand/index.cjs");

// The OUTARCH icon on the gateway's own page, inlined because the gateway
// serves a single route.
let brandIconDataUrl = null;
function brandIconUrl() {
  if (brandIconDataUrl === null) {
    try { brandIconDataUrl = `data:image/png;base64,${fs.readFileSync(BRAND_ASSETS.iconPng128).toString("base64")}`; }
    catch { brandIconDataUrl = ""; }
  }
  return brandIconDataUrl;
}

const MCP_PROTOCOL_VERSION = "2026-07-28";
const MCP_LEGACY_VERSIONS = Object.freeze(["2025-11-25", "2025-06-18"]);
const MCP_SUPPORTED_VERSIONS = Object.freeze([MCP_PROTOCOL_VERSION, ...MCP_LEGACY_VERSIONS]);
const MCP_ENDPOINT_PATH = "/mcp";
const MAX_MCP_REQUEST_BYTES = 256 * 1024;
const MAX_MCP_CONCURRENT_REQUESTS = 8;
const MCP_APPROVAL_TTL_MS = 15 * 60 * 1000;
const CLIENT_ACTIVE_WINDOW_MS = 5 * 60 * 1000;

const RESOURCE_DEFINITIONS = Object.freeze([
  { scope: "context.read", uri: "mission-control://supervision/current", name: "project_supervision", title: "Project Supervision", description: "Unified facts, inferences, evidence IDs, running work, recent changes, and Needs You state." },
  { scope: "context.read", uri: "mission-control://context/current", name: "mission_context", title: "Current Mission Context", description: "Bounded, structured, redacted state from the active OUTARCH project." },
  { scope: "context.read", uri: "mission-control://workers/current", name: "workers", title: "Current Workers", description: "Engine-owned workers plus explicitly owned VS Code terminal metadata from the unified supervision snapshot." },
  { scope: "context.read", uri: "mission-control://history/recent", name: "recent_history", title: "Recent History", description: "Bounded recent engine activity with stable evidence IDs." },
  { scope: "context.read", uri: "mission-control://recipes/current", name: "workspace_recipes", title: "Workspace Recipes", description: "Current dependency-aware workspace recipes and profiles." },
  { scope: "context.read", uri: "mission-control://vscode/current", name: "vscode_supervision", title: "VS Code Supervision", description: "VS Code connection, diagnostics, Git, tasks, and explicit terminal ownership metadata." },
  { scope: "memory.read", uri: "mission-control://memory/current", name: "project_memory", title: "Project Memory", description: "Resumable run chapters and causal relationships recorded by OUTARCH." },
  { scope: "attention.read", uri: "mission-control://attention/current", name: "needs_you", title: "Needs You", description: "Current human-attention queue and lifecycle state." }
]);

const TOOL_DEFINITIONS = Object.freeze([
  {
    scope: "context.read",
    name: "mission_control_supervision",
    title: "Read Project Supervision",
    description: "Read the same bounded facts, inferences, evidence IDs, and three-part briefing used by Groundstation and Mission AI.",
    inputSchema: { type: "object", properties: { afterSequence: { type: "integer", minimum: 0 }, includeTerminalEvidence: { type: "boolean", description: "Requires the separate terminal.read permission." } }, additionalProperties: false }
  },
  {
    scope: "context.read",
    name: "mission_control_context",
    title: "Read Mission Context",
    description: "Read bounded project, worker, health, dependency, mission, recipe, and editor state. Source code and environment values are omitted.",
    inputSchema: { type: "object", properties: { afterSequence: { type: "integer", minimum: 0 }, includeTerminalEvidence: { type: "boolean", description: "Requires the separate terminal.read permission." }, workerIds: { type: "array", maxItems: 10, items: { type: "string" } } }, additionalProperties: false }
  },
  {
    scope: "context.read",
    name: "mission_control_worker",
    title: "Inspect Worker",
    description: "Read one engine-owned worker's bounded lifecycle, health, resources, dependency impact, and structured evidence.",
    inputSchema: { type: "object", properties: { workerId: { type: "string", minLength: 1, maxLength: 64 }, includeTerminalEvidence: { type: "boolean", description: "Requires the separate terminal.read permission." } }, required: ["workerId"], additionalProperties: false }
  },
  {
    scope: "memory.read",
    name: "mission_control_memory",
    title: "Read Project Memory",
    description: "Read resumable chapters, verified recovery chains, and causal relationships from durable engine activity.",
    inputSchema: { type: "object", properties: { afterSequence: { type: "integer", minimum: 0 } }, additionalProperties: false }
  },
  {
    scope: "attention.read",
    name: "mission_control_attention",
    title: "Read Needs You",
    description: "Read only items that currently require human attention plus their engine lifecycle.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    scope: "worker.lifecycle.request",
    name: "mission_control_request_worker_action",
    title: "Request Worker Action",
    description: "Request start, restart, stop, or acknowledge for an existing worker. This never executes directly; it creates a local approval in Needs You.",
    inputSchema: { type: "object", properties: { workerId: { type: "string", minLength: 1, maxLength: 64 }, action: { type: "string", enum: ["start", "restart", "stop", "acknowledge"] }, reason: { type: "string", minLength: 1, maxLength: 500 } }, required: ["workerId", "action", "reason"], additionalProperties: false }
  },
  {
    scope: "recipe.run.request",
    name: "mission_control_request_recipe_action",
    title: "Request Recipe Action",
    description: "Request run, recovery run, or cancel for an existing Workspace Recipe. This creates a local approval and cannot execute remotely.",
    inputSchema: { type: "object", properties: { recipeId: { type: "string", minLength: 1, maxLength: 64 }, action: { type: "string", enum: ["run", "recover", "cancel"] }, reason: { type: "string", minLength: 1, maxLength: 500 } }, required: ["recipeId", "action", "reason"], additionalProperties: false }
  },
  {
    scope: "supervisor.plan.request",
    name: "mission_control_plan",
    title: "Plan Workspace Actions",
    description: "Ask the configured Gemini Mission Supervisor to propose a validated plan. The plan appears in Needs You and never executes directly.",
    inputSchema: { type: "object", properties: { instruction: { type: "string", minLength: 1, maxLength: 1200 } }, required: ["instruction"], additionalProperties: false }
  },
  {
    scope: "worker.create.request",
    name: "mission_control_request_create_worker",
    title: "Request Worker Creation",
    description: "Request one project-scoped worker definition. The exact definition is validated and waits for local approval.",
    inputSchema: { type: "object", properties: { id: { type: "string", minLength: 1, maxLength: 64 }, name: { type: "string", maxLength: 80 }, command: { type: "string", minLength: 1, maxLength: 1024 }, args: { type: "array", maxItems: 64, items: { type: "string" } }, cwd: { type: "string", maxLength: 1024 }, reason: { type: "string", minLength: 1, maxLength: 500 } }, required: ["id", "command", "reason"], additionalProperties: false }
  },
  {
    scope: "terminal.input.request",
    name: "mission_control_request_terminal_input",
    title: "Request Terminal Input",
    description: "Request exact bounded input for an existing Mission-Control-owned worker. It waits for explicit local approval and rejects secret-bearing input.",
    inputSchema: { type: "object", properties: { workerId: { type: "string", minLength: 1, maxLength: 64 }, input: { type: "string", minLength: 1, maxLength: 2048 }, reason: { type: "string", minLength: 1, maxLength: 500 } }, required: ["workerId", "input", "reason"], additionalProperties: false }
  }
]);

class McpGatewayError extends Error {
  constructor(code, message, status = 400, data = undefined) {
    super(message);
    this.name = "McpGatewayError";
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeIdentifier(value, fallback = "unknown-client", maximum = 120) {
  const normalized = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (normalized || fallback).slice(0, maximum);
}

function safeReason(value) {
  const sanitized = redactText(value, { maxLength: 500 });
  return sanitized.value.trim() || "No reason provided";
}

function textResult(value, text = null) {
  const serialized = JSON.stringify(value);
  return {
    resultType: "complete",
    content: [{ type: "text", text: text || serialized }],
    structuredContent: value,
    isError: false
  };
}

function complete(value = {}) {
  return { resultType: "complete", ...value };
}

function decodeHeaderValue(value) {
  if (typeof value !== "string") return value;
  if (!value.startsWith("=?base64?") || !value.endsWith("?=")) return value;
  const encoded = value.slice(10, -2);
  try { return Buffer.from(encoded, "base64").toString("utf8"); }
  catch { return null; }
}

function jsonRpcError(id, error) {
  const data = error.data === undefined ? undefined : error.data;
  return { jsonrpc: "2.0", id: id ?? null, error: { code: error.code, message: error.message, ...(data === undefined ? {} : { data }) } };
}

function allowedOrigin(origin) {
  if (!origin) return true;
  if (origin === "null") return false;
  try {
    const parsed = new URL(origin);
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function timingSafeTokenMatch(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function validateArguments(schemaName, value) {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new McpGatewayError(-32602, `${schemaName} arguments must be an object`);
  return value;
}

function resolveClientConfigPath(target, workspacePath = "", customOs = os) {
  const home = customOs.homedir();
  switch (target) {
    case "claude-desktop": {
      if (process.platform === "win32") {
        const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
        return path.join(appData, "Claude", "claude_desktop_config.json");
      }
      if (process.platform === "darwin") {
        return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
      }
      const configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
      return path.join(configHome, "Claude", "claude_desktop_config.json");
    }
    case "claude-code": {
      return path.join(home, ".claude.json");
    }
    case "cursor": {
      if (workspacePath && typeof workspacePath === "string") {
        return path.join(path.resolve(workspacePath), ".cursor", "mcp.json");
      }
      return path.join(home, ".cursor", "mcp.json");
    }
    // Codex CLI reads TOML from its home directory, which CODEX_HOME can move.
    case "codex": {
      return path.join(process.env.CODEX_HOME || path.join(home, ".codex"), "config.toml");
    }
    case "gemini-cli": {
      return path.join(home, ".gemini", "settings.json");
    }
    default:
      throw new TypeError(`Unsupported client install target: ${target}`);
  }
}

const CLIENT_LABELS = Object.freeze({
  "claude-desktop": "Claude Desktop",
  "claude-code": "Claude Code",
  cursor: "Cursor",
  codex: "Codex CLI",
  "gemini-cli": "Gemini CLI"
});

function tomlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

// The name OUTARCH's server is registered under in MCP clients. Older builds
// used "mission-control"; installing replaces that entry and removing clears
// both, so a client never lists OUTARCH twice.
const MCP_SERVER_NAME = "outarch";
const LEGACY_MCP_SERVER_NAMES = Object.freeze(["mission-control"]);
const OWN_SERVER_NAMES = Object.freeze([MCP_SERVER_NAME, ...LEGACY_MCP_SERVER_NAMES]);

function isOwnCodexSection(header) {
  const name = header.trim();
  return OWN_SERVER_NAMES.some(server => name === `mcp_servers.${server}` || name.startsWith(`mcp_servers.${server}.`));
}

function hasOwnCodexSection(content) {
  return String(content || "").split(/\r?\n/).some(line => {
    const header = line.trim().match(/^\[([^\]]+)\]$/);
    return Boolean(header && isOwnCodexSection(header[1]));
  });
}

function withCodexServer(content, endpoint, token) {
  const lines = String(content || "").split(/\r?\n/);
  const kept = [];
  let skipping = false;
  for (const line of lines) {
    const header = line.trim().match(/^\[([^\]]+)\]$/);
    if (header) skipping = isOwnCodexSection(header[1]);
    if (!skipping) kept.push(line);
  }
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  const section = [
    `[mcp_servers.${MCP_SERVER_NAME}]`,
    `command = ${tomlString("npx")}`,
    `args = [${["-y", "mcp-remote", endpoint, "--header", `Authorization: Bearer ${token}`].map(tomlString).join(", ")}]`
  ];
  return `${kept.length ? `${kept.join("\n")}\n\n` : ""}${section.join("\n")}\n`;
}

// These files belong to other tools (Claude, Cursor, Codex, Gemini). A write
// goes to a temporary file that replaces the original in one step, so a crash
// cannot leave half a config behind. Where the replace is refused (the file is
// held open by its tool) the write goes to the file directly, as before.
function writeClientConfig(fileSystem, filePath, content) {
  if (typeof fileSystem.renameSync !== "function") {
    fileSystem.writeFileSync(filePath, content, "utf8");
    return;
  }
  const temporary = `${filePath}.outarch-${process.pid}-${Date.now()}.tmp`;
  fileSystem.writeFileSync(temporary, content, "utf8");
  try {
    fileSystem.renameSync(temporary, filePath);
  } catch {
    try { fileSystem.rmSync?.(temporary, { force: true }); } catch { /* best effort */ }
    fileSystem.writeFileSync(filePath, content, "utf8");
  }
}

function readClientJson(fileSystem, configPath, target) {
  if (!fileSystem.existsSync(configPath)) return {};
  let config;
  try {
    const content = fileSystem.readFileSync(configPath, "utf8");
    config = content.trim() ? JSON.parse(content) : {};
  } catch (err) {
    throw new Error(`Could not parse existing ${target} configuration file: ${err.message}`);
  }
  // Anything but an object is not a file this app understands; it is left alone.
  if (!isPlainObject(config)) throw new Error(`The ${target} configuration file is not a JSON object, so OUTARCH left it unchanged`);
  return config;
}

function withoutCodexServer(content) {
  const lines = String(content || "").split(/\r?\n/);
  const kept = [];
  let skipping = false;
  for (const line of lines) {
    const header = line.trim().match(/^\[([^\]]+)\]$/);
    if (header) skipping = isOwnCodexSection(header[1]);
    if (!skipping) kept.push(line);
  }
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  return kept.length ? `${kept.join("\n")}\n` : "";
}

class SecureMcpGateway extends EventEmitter {
  constructor(options = {}) {
    super();
    if (!options.store) throw new TypeError("SecureMcpGateway requires a credential store");
    if (!options.missionContext || typeof options.missionContext.snapshot !== "function") throw new TypeError("SecureMcpGateway requires Mission Context");
    if (typeof options.getEngineApi !== "function") throw new TypeError("SecureMcpGateway requires getEngineApi");
    this.store = options.store;
    this.missionContext = options.missionContext;
    this.projectSupervision = options.projectSupervision && typeof options.projectSupervision.snapshot === "function" ? options.projectSupervision : null;
    this.getEngineApi = options.getEngineApi;
    this.missionSupervisor = options.missionSupervisor || null;
    this.http = options.http || http;
    this.fs = options.fs || fs;
    this.os = options.os || os;
    this.now = options.now || Date.now;
    this.randomUUID = options.randomUUID || crypto.randomUUID;
    this.server = null;
    this.address = null;
    this.starting = null;
    this.activeRequests = 0;
    this.clients = new Map();
    this.approvals = new Map();
    this.disposed = false;
    this.lastError = null;
    // The operator's plan: "none" keeps the gateway off, "read" serves only the
    // read scopes, "full" serves every scope the operator granted.
    this.accessLevel = typeof options.accessLevel === "function" ? options.accessLevel : () => "full";
  }

  #planLevel() {
    try {
      const level = this.accessLevel();
      return ["none", "read", "full"].includes(level) ? level : "none";
    } catch {
      return "none";
    }
  }

  // The scopes the operator granted, narrowed to what their plan includes.
  #effectiveScopes() {
    const granted = this.store.status().scopes || [];
    const level = this.#planLevel();
    if (level === "none") return [];
    if (level === "read") return granted.filter(scope => /\.read$/.test(scope));
    return [...granted];
  }

  status() {
    this.#expireApprovals();
    const stored = this.store.status();
    const activeCutoff = this.now() - CLIENT_ACTIVE_WINDOW_MS;
    for (const [client, at] of this.clients) if (at < activeCutoff) this.clients.delete(client);
    const pending = [...this.approvals.values()].filter(item => item.state === "pending");
    return {
      available: stored.available === true,
      enabled: stored.enabled === true,
      running: Boolean(this.server?.listening),
      configured: stored.configured === true,
      endpoint: this.address ? `http://127.0.0.1:${this.address.port}${MCP_ENDPOINT_PATH}` : `http://127.0.0.1:${stored.port}${MCP_ENDPOINT_PATH}`,
      host: "127.0.0.1",
      port: this.address?.port || stored.port,
      scopes: [...stored.scopes],
      protection: stored.protection,
      backend: stored.backend,
      protocolVersions: [...MCP_SUPPORTED_VERSIONS],
      clientCount: this.clients.size,
      pendingApprovalCount: pending.length,
      auditCount: stored.auditCount,
      lastError: this.lastError || stored.error || null,
      authority: "approval-gated",
      planLevel: this.#planLevel()
    };
  }

  subscribe(callback) {
    if (typeof callback !== "function") throw new TypeError("MCP gateway subscribe requires a callback");
    this.on("status", callback);
    return () => this.off("status", callback);
  }

  async configure(configuration = {}) {
    const previous = this.store.status();
    const next = this.store.configure(configuration);
    const restart = this.server?.listening && next.enabled && previous.port !== next.port;
    try {
      if (!next.enabled) await this.stop();
      else if (!this.server?.listening || restart) {
        if (restart) await this.stop();
        await this.start();
      }
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.#emitStatus();
      throw error;
    }
    this.#audit({ kind: "configuration", outcome: next.enabled ? "enabled" : "disabled", client: "local-operator", capability: next.scopes.join(",") || "none" });
    this.#emitStatus();
    return this.status();
  }

  async start() {
    if (this.disposed) throw new Error("MCP gateway is disposed");
    if (this.server?.listening) return this.status();
    if (this.starting) return this.starting;
    const stored = this.store.status();
    if (!stored.enabled) return this.status();
    if (this.#planLevel() === "none") return this.status();
    if (!stored.available) throw new Error("OS credential encryption is unavailable; the MCP gateway stays disabled");
    this.store.token();
    this.starting = new Promise((resolve, reject) => {
      const server = this.http.createServer((request, response) => void this.#handleHttp(request, response));
      server.requestTimeout = 15_000;
      server.headersTimeout = 10_000;
      server.keepAliveTimeout = 5_000;
      server.maxHeadersCount = 64;
      server.once("error", error => {
        if (this.server === server) this.server = null;
        this.starting = null;
        reject(new Error(`Secure MCP Gateway could not bind to 127.0.0.1:${stored.port}: ${error.message}`));
      });
      server.listen(stored.port, "127.0.0.1", () => {
        this.server = server;
        this.address = server.address();
        this.starting = null;
        this.lastError = null;
        this.#emitStatus();
        resolve(this.status());
      });
    });
    return this.starting;
  }

  async stop() {
    const server = this.server;
    this.server = null;
    this.address = null;
    if (!server) return this.status();
    await new Promise(resolve => server.close(() => resolve()));
    this.clients.clear();
    this.#emitStatus();
    return this.status();
  }

  rotateToken() {
    const token = this.store.rotateToken();
    this.clients.clear();
    this.#audit({ kind: "credential", outcome: "rotated", client: "local-operator" });
    this.#emitStatus();
    return { token, endpoint: this.status().endpoint, authorization: `Bearer ${token}`, status: this.status() };
  }

  getToken() {
    let token = "";
    try { token = this.store.token(); }
    catch { token = ""; }
    const status = this.status();
    return {
      token,
      configured: Boolean(token),
      endpoint: status.endpoint,
      authorization: token ? `Bearer ${token}` : "",
      status
    };
  }

  installClient({ target, workspacePath = "" } = {}) {
    if (!Object.hasOwn(CLIENT_LABELS, target)) {
      throw new TypeError(`Unsupported client install target: ${target}`);
    }
    const token = this.store.token();
    const endpoint = this.status().endpoint;
    const configPath = resolveClientConfigPath(target, workspacePath, this.os);
    const dir = path.dirname(configPath);
    if (!this.fs.existsSync(dir)) {
      this.fs.mkdirSync(dir, { recursive: true });
    }
    if (target === "codex") {
      const existing = this.fs.existsSync(configPath) ? this.fs.readFileSync(configPath, "utf8") : "";
      writeClientConfig(this.fs, configPath, withCodexServer(existing, endpoint, token));
      this.#audit({ kind: "client-install", outcome: "installed", client: target, target: configPath });
      return { ok: true, target, filePath: configPath, message: "Successfully configured Codex CLI! Start a new Codex session to use OUTARCH." };
    }
    const config = readClientJson(this.fs, configPath, target);
    if (config.mcpServers !== undefined && !isPlainObject(config.mcpServers)) {
      throw new Error(`The ${target} configuration has an unexpected "mcpServers" value, so OUTARCH left it unchanged`);
    }
    if (!isPlainObject(config.mcpServers)) config.mcpServers = {};
    for (const legacy of LEGACY_MCP_SERVER_NAMES) delete config.mcpServers[legacy];

    if (target === "gemini-cli") {
      config.mcpServers[MCP_SERVER_NAME] = {
        httpUrl: endpoint,
        headers: {
          Authorization: `Bearer ${token}`
        }
      };
    } else if (target === "cursor") {
      config.mcpServers[MCP_SERVER_NAME] = {
        name: MCP_SERVER_NAME,
        type: "http",
        url: endpoint,
        headers: {
          Authorization: `Bearer ${token}`
        }
      };
    } else {
      config.mcpServers[MCP_SERVER_NAME] = {
        command: "npx",
        args: [
          "-y",
          "mcp-remote",
          endpoint,
          "--header",
          `Authorization: Bearer ${token}`
        ]
      };
    }

    writeClientConfig(this.fs, configPath, `${JSON.stringify(config, null, 2)}\n`);
    this.#audit({ kind: "client-install", outcome: "installed", client: target, target: configPath });
    const targetLabel = CLIENT_LABELS[target];
    return {
      ok: true,
      target,
      filePath: configPath,
      message: `Successfully configured ${targetLabel}! Restart ${targetLabel} to start using OUTARCH.`
    };
  }

  removeClient({ target, workspacePath = "" } = {}) {
    if (!Object.hasOwn(CLIENT_LABELS, target)) {
      throw new TypeError(`Unsupported client remove target: ${target}`);
    }
    const configPath = resolveClientConfigPath(target, workspacePath, this.os);
    const targetLabel = CLIENT_LABELS[target];
    if (!this.fs.existsSync(configPath)) {
      return {
        ok: true,
        target,
        filePath: configPath,
        removed: false,
        message: `No configuration file found for ${targetLabel}.`
      };
    }

    if (target === "codex") {
      const existing = this.fs.readFileSync(configPath, "utf8");
      const updated = withoutCodexServer(existing);
      // Nothing of ours in the file: it is not rewritten.
      if (updated === existing || !hasOwnCodexSection(existing)) {
        return { ok: true, target, filePath: configPath, removed: false, message: "OUTARCH was not configured in Codex CLI." };
      }
      writeClientConfig(this.fs, configPath, updated);
      this.#audit({ kind: "client-remove", outcome: "removed", client: target, target: configPath });
      return {
        ok: true,
        target,
        filePath: configPath,
        removed: true,
        message: `Successfully removed OUTARCH from Codex CLI! Restart Codex to apply.`
      };
    }

    const config = readClientJson(this.fs, configPath, target);

    let removed = false;
    if (isPlainObject(config)) {
      for (const server of OWN_SERVER_NAMES) {
        if (isPlainObject(config.mcpServers) && Object.hasOwn(config.mcpServers, server)) {
          delete config.mcpServers[server];
          removed = true;
        }
      }
      if (OWN_SERVER_NAMES.includes(config.name)) {
        delete config.name;
        delete config.type;
        delete config.url;
        delete config.headers;
        removed = true;
      }
    }

    if (!removed) {
      return { ok: true, target, filePath: configPath, removed: false, message: `OUTARCH was not configured in ${targetLabel}.` };
    }
    writeClientConfig(this.fs, configPath, `${JSON.stringify(config, null, 2)}\n`);
    this.#audit({ kind: "client-remove", outcome: "removed", client: target, target: configPath });
    return {
      ok: true,
      target,
      filePath: configPath,
      removed: true,
      message: `Successfully removed OUTARCH from ${targetLabel}! Restart ${targetLabel} to apply.`
    };
  }

  clientStatus({ workspacePath = "" } = {}) {
    const statuses = {};
    for (const target of Object.keys(CLIENT_LABELS)) {
      try {
        const configPath = resolveClientConfigPath(target, workspacePath, this.os);
        let installed = false;
        if (this.fs.existsSync(configPath)) {
          const content = this.fs.readFileSync(configPath, "utf8");
          if (target === "codex") {
            installed = hasOwnCodexSection(content);
          } else {
            const config = content.trim() ? JSON.parse(content) : {};
            installed = OWN_SERVER_NAMES.some(server => Boolean(config?.mcpServers?.[server])) || OWN_SERVER_NAMES.includes(config?.name);
          }
        }
        statuses[target] = {
          target,
          name: CLIENT_LABELS[target],
          installed,
          filePath: configPath
        };
      } catch {
        statuses[target] = {
          target,
          name: CLIENT_LABELS[target],
          installed: false,
          filePath: ""
        };
      }
    }
    return statuses;
  }

  listApprovals() {
    this.#expireApprovals();
    return [...this.approvals.values()].sort((a, b) => b.createdAt - a.createdAt).map(clone);
  }

  listAudit(limit = 50) {
    return this.store.listAudit(limit);
  }

  async resolveApproval(id, decision) {
    this.#expireApprovals();
    const approval = this.approvals.get(String(id));
    if (!approval) throw new Error("MCP approval request was not found");
    if (approval.state !== "pending") throw new Error(`MCP approval is already ${approval.state}`);
    if (!["approve", "deny"].includes(decision)) throw new TypeError("MCP approval decision must be approve or deny");
    if (decision === "deny") {
      approval.state = "denied";
      approval.resolvedAt = this.now();
      this.#audit({ kind: "approval", outcome: "denied", client: approval.client, capability: approval.capability, target: approval.target });
      this.#emitStatus();
      return clone(approval);
    }
    const scopes = this.#effectiveScopes();
    if (!scopes.includes(approval.scope)) throw new Error("MCP permission was revoked before approval");
    approval.state = "executing";
    approval.resolvedAt = this.now();
    this.#emitStatus();
    try {
      approval.result = await this.#executeApproval(approval);
      approval.state = "approved";
      this.#audit({ kind: "approval", outcome: "approved", client: approval.client, capability: approval.capability, target: approval.target });
    } catch (error) {
      approval.state = "failed";
      approval.error = error instanceof Error ? error.message : String(error);
      this.#audit({ kind: "approval", outcome: "failed", client: approval.client, capability: approval.capability, target: approval.target });
    }
    approval.completedAt = this.now();
    this.#emitStatus();
    return clone(approval);
  }

  async dispatchRequest(request, context = {}) {
    if (!isPlainObject(request) || request.jsonrpc !== "2.0" || !(typeof request.id === "string" || typeof request.id === "number" || request.id === undefined)) {
      throw new McpGatewayError(-32600, "Invalid JSON-RPC request");
    }
    if (typeof request.method !== "string" || !request.method) throw new McpGatewayError(-32600, "JSON-RPC method is required");
    const params = request.params === undefined ? {} : request.params;
    if (!isPlainObject(params)) throw new McpGatewayError(-32602, "JSON-RPC params must be an object");
    const client = this.#clientName(request, context);
    this.clients.set(client, this.now());
    const scopes = this.#effectiveScopes();
    const modern = context.protocolVersion === MCP_PROTOCOL_VERSION;

    switch (request.method) {
      case "server/discover":
        return complete({
          supportedVersions: [...MCP_SUPPORTED_VERSIONS],
          capabilities: { tools: {}, resources: {} },
          _meta: { "io.modelcontextprotocol/serverInfo": { name: "OUTARCH Secure MCP Gateway", version: "2.16.0" } },
          instructions: "Use bounded read tools for OUTARCH state. Mutation tools create local approvals and never execute directly.",
          ttlMs: 60_000,
          cacheScope: "private"
        });
      case "initialize": {
        const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : MCP_LEGACY_VERSIONS[0];
        const negotiated = MCP_SUPPORTED_VERSIONS.includes(requested) ? requested : MCP_LEGACY_VERSIONS[0];
        return { protocolVersion: negotiated, capabilities: { tools: {}, resources: {} }, serverInfo: { name: "OUTARCH Secure MCP Gateway", version: "2.16.0" }, instructions: "Read access is bounded and redacted. Mutation tools create local approval requests." };
      }
      case "notifications/initialized":
      case "ping":
        return {};
      case "tools/list":
        return complete({ tools: TOOL_DEFINITIONS.filter(tool => scopes.includes(tool.scope)).map(tool => clone(tool)).map(({ scope, ...tool }) => tool), ttlMs: 30_000, cacheScope: "private" });
      case "resources/list":
        return complete({ resources: RESOURCE_DEFINITIONS.filter(resource => scopes.includes(resource.scope)).map(({ scope, ...resource }) => ({ ...resource, mimeType: "application/json" })), ttlMs: 30_000, cacheScope: "private" });
      case "resources/read":
        return this.#readResource(params, scopes, client);
      case "tools/call":
        return await this.#callTool(params, scopes, client, modern);
      default:
        throw new McpGatewayError(-32601, `Method not found: ${request.method}`, 404);
    }
  }

  async dispose() {
    if (this.disposed) return false;
    this.disposed = true;
    await this.stop();
    for (const approval of this.approvals.values()) if (approval.state === "pending") approval.state = "cancelled";
    this.removeAllListeners();
    return true;
  }

  #clientName(request, context) {
    const info = request.params?._meta?.["io.modelcontextprotocol/clientInfo"] || request.params?.clientInfo;
    return safeIdentifier(info?.name || context.client || "unknown-client");
  }

  #requireScope(scopes, scope) {
    if (!scopes.includes(scope)) throw new McpGatewayError(-32001, `Permission required: ${scope}`, 403);
  }

  #snapshot(argumentsValue, scopes) {
    const args = validateArguments("Mission Context", argumentsValue);
    const includeOutput = args.includeTerminalEvidence === true;
    if (includeOutput) this.#requireScope(scopes, "terminal.read");
    return this.missionContext.snapshot({
      afterSequence: Number.isInteger(args.afterSequence) && args.afterSequence >= 0 ? args.afterSequence : 0,
      includeOutput,
      workerIds: Array.isArray(args.workerIds) ? args.workerIds : []
    });
  }

  #supervision(argumentsValue, scopes) {
    const args = validateArguments("Project Supervision", argumentsValue);
    const includeOutput = args.includeTerminalEvidence === true;
    if (includeOutput) this.#requireScope(scopes, "terminal.read");
    if (!this.projectSupervision) throw new McpGatewayError(-32004, "Project Supervision is unavailable", 503);
    return this.projectSupervision.snapshot({
      afterSequence: Number.isInteger(args.afterSequence) && args.afterSequence >= 0 ? args.afterSequence : 0,
      includeOutput
    });
  }

  #readResource(params, scopes, client) {
    const uri = typeof params.uri === "string" ? params.uri : "";
    const resource = RESOURCE_DEFINITIONS.find(item => item.uri === uri);
    if (!resource) throw new McpGatewayError(-32602, "Resource not found");
    this.#requireScope(scopes, resource.scope);
    let value;
    let context;
    let supervision;
    const getContext = () => {
      if (!context) context = this.missionContext.snapshot({ afterSequence: 0 });
      return context;
    };
    const getSupervision = () => {
      if (!this.projectSupervision) throw new McpGatewayError(-32004, "Project Supervision is unavailable", 503);
      if (!supervision) supervision = this.projectSupervision.snapshot({ afterSequence: 0, includeOutput: false });
      return supervision;
    };
    if (uri === "mission-control://supervision/current") value = getSupervision();
    else if (uri === "mission-control://context/current") value = getContext();
    else if (uri === "mission-control://workers/current") {
      const snapshot = getSupervision();
      value = { workers: snapshot.facts?.workers || [], vscodeTerminals: snapshot.facts?.vscode?.terminals || [] };
    } else if (uri === "mission-control://history/recent") value = { events: getSupervision().facts?.history || [] };
    else if (uri === "mission-control://recipes/current") value = { recipes: getSupervision().facts?.recipes || [] };
    else if (uri === "mission-control://vscode/current") value = getSupervision().facts?.vscode || { connected: false };
    else if (resource.scope === "memory.read") value = getContext().projectMemory;
    else value = { records: getContext().attention };
    this.#audit({ kind: "resource", outcome: "read", client, capability: resource.scope, target: uri });
    return complete({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify(value) }], ttlMs: 5_000, cacheScope: "private" });
  }

  async #callTool(params, scopes, client) {
    const name = typeof params.name === "string" ? params.name : "";
    const tool = TOOL_DEFINITIONS.find(item => item.name === name);
    if (!tool) throw new McpGatewayError(-32602, `Unknown tool: ${name || "(missing)"}`);
    this.#requireScope(scopes, tool.scope);
    const args = validateArguments(name, params.arguments);
    let value;
    if (name === "mission_control_supervision") {
      value = this.#supervision(args, scopes);
    } else if (name === "mission_control_context") {
      value = this.#snapshot(args, scopes);
    } else if (name === "mission_control_worker") {
      if (typeof args.workerId !== "string" || !args.workerId) throw new McpGatewayError(-32602, "workerId is required");
      const context = this.#snapshot({ includeTerminalEvidence: args.includeTerminalEvidence === true, workerIds: [args.workerId] }, scopes);
      value = context.workers.find(worker => worker.id === args.workerId);
      if (!value) throw new McpGatewayError(-32602, `Worker not found: ${args.workerId}`);
    } else if (name === "mission_control_memory") {
      value = this.missionContext.snapshot({ afterSequence: Number.isInteger(args.afterSequence) && args.afterSequence >= 0 ? args.afterSequence : 0 }).projectMemory;
    } else if (name === "mission_control_attention") {
      value = { records: this.missionContext.snapshot({ afterSequence: 0 }).attention };
    } else if (name === "mission_control_plan") {
      if (!this.missionSupervisor?.propose) throw new McpGatewayError(-32004, "Mission Supervisor is unavailable", 503);
      if (typeof args.instruction !== "string" || !args.instruction.trim()) throw new McpGatewayError(-32602, "instruction is required");
      value = await this.missionSupervisor.propose({ instruction: args.instruction });
    } else if (name === "mission_control_request_create_worker") {
      if (!this.missionSupervisor?.requestPlan) throw new McpGatewayError(-32004, "Mission Supervisor is unavailable", 503);
      value = this.missionSupervisor.requestPlan({ summary: `Create worker ${safeIdentifier(args.id, "worker", 64)}`, actions: [{ type: "create-worker", ...args, definition: { id: args.id, name: args.name, command: args.command, args: args.args, cwd: args.cwd }, reason: args.reason }] }, { source: `mcp:${client}`, instruction: safeReason(args.reason) });
    } else if (name === "mission_control_request_terminal_input") {
      if (!this.missionSupervisor?.requestPlan) throw new McpGatewayError(-32004, "Mission Supervisor is unavailable", 503);
      value = this.missionSupervisor.requestPlan({ summary: `Send approved input to ${safeIdentifier(args.workerId, "worker", 64)}`, actions: [{ type: "terminal-input", workerId: args.workerId, input: args.input, reason: args.reason }] }, { source: `mcp:${client}`, instruction: safeReason(args.reason) });
    } else {
      value = this.#createApproval(tool, args, client);
    }
    this.#audit({ kind: "tool", outcome: value?.state === "pending" ? "approval-requested" : "completed", client, capability: tool.scope, target: value?.target || name });
    return textResult(value, value?.state === "pending" ? `Approval ${value.id} is waiting in OUTARCH Needs You. No action has executed.` : null);
  }

  #createApproval(tool, args, client) {
    const now = this.now();
    let approval;
    if (tool.name === "mission_control_request_worker_action") {
      const workerId = safeIdentifier(args.workerId, "", 64);
      const action = String(args.action || "");
      const worker = this.getEngineApi().getSnapshot(workerId);
      if (!worker) throw new McpGatewayError(-32602, `Worker not found: ${workerId}`);
      if (!["start", "restart", "stop", "acknowledge"].includes(action)) throw new McpGatewayError(-32602, "Worker action is invalid");
      approval = { type: "worker", target: workerId, targetName: worker.name, action, reason: safeReason(args.reason) };
    } else {
      const recipeId = safeIdentifier(args.recipeId, "", 64);
      const action = String(args.action || "");
      const recipe = this.getEngineApi().listRecipes().find(item => item.id === recipeId);
      if (!recipe) throw new McpGatewayError(-32602, `Recipe not found: ${recipeId}`);
      if (!["run", "recover", "cancel"].includes(action)) throw new McpGatewayError(-32602, "Recipe action is invalid");
      approval = { type: "recipe", target: recipeId, targetName: recipe.name, action, reason: safeReason(args.reason) };
    }
    const record = {
      id: `mcp-approval-${this.randomUUID()}`,
      state: "pending",
      scope: tool.scope,
      capability: tool.name,
      client,
      createdAt: now,
      expiresAt: now + MCP_APPROVAL_TTL_MS,
      ...approval
    };
    this.approvals.set(record.id, record);
    while (this.approvals.size > 100) this.approvals.delete(this.approvals.keys().next().value);
    this.#emitStatus();
    return clone(record);
  }

  async #executeApproval(approval) {
    const engine = this.getEngineApi();
    let result;
    if (approval.type === "worker") {
      const operation = approval.action === "stop" ? "kill" : approval.action;
      result = engine[operation](approval.target);
      if (result && typeof result.then === "function") result = await result;
    } else if (approval.action === "cancel") {
      result = engine.cancelRecipe(approval.target);
    } else {
      result = engine.runRecipe(approval.target, { recover: approval.action === "recover" });
    }
    if (!result?.ok) throw new Error(result?.error || "EngineAPI rejected the approved MCP action");
    return clone(result);
  }

  #expireApprovals() {
    const now = this.now();
    for (const approval of this.approvals.values()) {
      if (approval.state === "pending" && approval.expiresAt <= now) {
        approval.state = "expired";
        approval.resolvedAt = now;
        this.#audit({ kind: "approval", outcome: "expired", client: approval.client, capability: approval.capability, target: approval.target });
      }
    }
  }

  #renderDiscoveryHtml(port, stored) {
    const scopes = stored.scopes || [];
    const activeTools = TOOL_DEFINITIONS.filter(t => scopes.includes(t.scope));
    const toolsHtml = activeTools.map(t => `<div class="card">
      <div class="card-head">
        <strong>${t.name}</strong>
        <span class="badge ${t.scope.includes("request") ? "badge-approval" : "badge-read"}">${t.scope.includes("request") ? "APPROVAL GATED" : "READ ONLY"}</span>
      </div>
      <p>${t.description}</p>
      <code>Scope: ${t.scope}</code>
    </div>`).join("\n");

    const sampleClaudeConfig = JSON.stringify({
      mcpServers: {
        [MCP_SERVER_NAME]: {
          command: "npx",
          args: ["-y", "mcp-remote", `http://127.0.0.1:${port}/mcp`, "--header", "Authorization: Bearer <TOKEN>"]
        }
      }
    }, null, 2);

    const sampleCursorConfig = JSON.stringify({
      name: MCP_SERVER_NAME,
      type: "http",
      url: `http://127.0.0.1:${port}/mcp`,
      headers: {
        Authorization: "Bearer <TOKEN>"
      }
    }, null, 2);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OUTARCH · Secure MCP Gateway</title>
${brandIconUrl() ? `<link rel="icon" type="image/png" href="${brandIconUrl()}">` : ""}
<style>
  :root {
    --bg: #000000;
    --surface: #171717;
    --surface-2: #1f1f1f;
    --border: #2e2e2e;
    --text: #fafafa;
    --text-dim: #a1a1a1;
    --accent: #3291ff;
    --accent-dim: #0070f326;
    --ok: #32d583;
    --ok-dim: #32d58322;
    --amber: #f5b942;
    --font-mono: "SFMono-Regular", Consolas, Menlo, Monaco, monospace;
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-sans);
    line-height: 1.5;
    padding: 32px 20px;
  }
  .container { max-width: 960px; margin: 0 auto; }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 24px;
  }
  .title-group { display: flex; align-items: center; gap: 14px; }
  .logo {
    width: 42px; height: 42px; border-radius: 10px; flex: 0 0 auto;
    display: grid; place-items: center; background: var(--bg); color: var(--text);
    font-weight: 800; font-size: 18px;
  }
  h1 { font-size: 20px; font-weight: 650; }
  p.subtitle { font-size: 13px; color: var(--text-dim); }
  .status-pill {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 6px 12px; border-radius: 9999px;
    background: var(--ok-dim); border: 1px solid #32d58344;
    color: var(--ok); font-size: 12px; font-weight: 600;
  }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
  .grid-stats {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px; margin-bottom: 28px;
  }
  .stat-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 14px;
  }
  .stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); }
  .stat-value { font-size: 15px; font-weight: 600; font-family: var(--font-mono); margin-top: 4px; color: var(--text); }
  section { margin-bottom: 32px; }
  h2 { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
  .tools-list { display: grid; gap: 10px; }
  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 14px;
  }
  .card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  .card-head strong { font-family: var(--font-mono); font-size: 13px; color: var(--accent); }
  .card p { font-size: 13px; color: var(--text-dim); margin-bottom: 8px; }
  .card code { font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); background: var(--surface-2); padding: 2px 6px; border-radius: 4px; }
  .badge { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; }
  .badge-read { background: var(--accent-dim); color: var(--accent); border: 1px solid #0070f366; }
  .badge-approval { background: #2e2614; color: var(--amber); border: 1px solid #544520; }
  pre {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 14px; overflow-x: auto;
    font-family: var(--font-mono); font-size: 12px; color: #d4d4d4; line-height: 1.45;
  }
  .note {
    background: var(--surface-2); border-left: 3px solid var(--accent);
    padding: 12px 14px; border-radius: 0 6px 6px 0; font-size: 13px;
    color: var(--text-dim); margin-top: 14px;
  }
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="title-group">
      ${brandIconUrl() ? `<img class="logo" src="${brandIconUrl()}" alt="">` : `<div class="logo">O</div>`}
      <div>
        <h1>OUTARCH Secure MCP Gateway</h1>
        <p class="subtitle">Model Context Protocol 2026-07-28 · JSON-RPC 2.0</p>
      </div>
    </div>
    <div class="status-pill">
      <span class="status-dot"></span>
      <span>Active · 127.0.0.1:${port}</span>
    </div>
  </header>

  <div class="grid-stats">
    <div class="stat-card">
      <div class="stat-label">Endpoint</div>
      <div class="stat-value">/mcp</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Transport</div>
      <div class="stat-value">HTTP POST + JSON-RPC</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Active Scopes</div>
      <div class="stat-value">${scopes.length} enabled</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Protection</div>
      <div class="stat-value">${stored.protection || "OS-encrypted"}</div>
    </div>
  </div>

  <section>
    <h2>Registered MCP Tools (${activeTools.length})</h2>
    <div class="tools-list">
      ${toolsHtml || "<div class='card'><p>No tools enabled. Configure permissions in OUTARCH Settings.</p></div>"}
    </div>
  </section>

  <section>
    <h2>Claude Desktop Setup (claude_desktop_config.json)</h2>
    <pre><code>${sampleClaudeConfig}</code></pre>
  </section>

  <section>
    <h2>Cursor Setup (.cursor/mcp.json)</h2>
    <pre><code>${sampleCursorConfig}</code></pre>
    <div class="note">
      <strong>Authentication:</strong> Copy your one-time token from the OUTARCH app settings (<strong>Integrations &rarr; MCP Gateway &rarr; Rotate token</strong>) and replace <code>&lt;TOKEN&gt;</code>.
    </div>
  </section>
</div>
</body>
</html>`;
  }

  #audit(record) {
    try { this.store.appendAudit({ ...record, id: `mcp-audit-${this.randomUUID()}`, at: this.now() }); }
    catch { /* Gateway operation remains available if bounded audit persistence fails. */ }
  }

  #emitStatus() {
    const status = this.status();
    for (const listener of this.rawListeners("status")) {
      try { listener(status); } catch { /* Integration observers cannot interrupt the gateway. */ }
    }
  }

  #validateModernHeaders(request, body) {
    const protocol = request.headers["mcp-protocol-version"];
    const metadataVersion = body.params?._meta?.["io.modelcontextprotocol/protocolVersion"];
    if (protocol !== MCP_PROTOCOL_VERSION || metadataVersion !== MCP_PROTOCOL_VERSION || protocol !== metadataVersion) {
      throw new McpGatewayError(-32020, "Header mismatch: MCP protocol version header and request metadata must both equal 2026-07-28", 400);
    }
    const metadata = body.params?._meta;
    if (!isPlainObject(metadata?.["io.modelcontextprotocol/clientInfo"]) || !isPlainObject(metadata?.["io.modelcontextprotocol/clientCapabilities"])) {
      throw new McpGatewayError(-32602, "Current MCP requests require clientInfo and clientCapabilities metadata", 400);
    }
    if (request.headers["mcp-method"] !== body.method) throw new McpGatewayError(-32020, "Header mismatch: Mcp-Method does not match the request body", 400);
    if (["tools/call", "resources/read"].includes(body.method)) {
      const expected = body.method === "tools/call" ? body.params?.name : body.params?.uri;
      const actual = decodeHeaderValue(request.headers["mcp-name"]);
      if (actual !== expected) throw new McpGatewayError(-32020, "Header mismatch: Mcp-Name does not match the request body", 400);
    }
  }

  async #handleHttp(request, response) {
    const send = (status, value, headers = {}) => {
      if (response.writableEnded) return;
      const body = value === null ? "" : JSON.stringify(value);
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...headers
      });
      response.end(body);
    };
    if (request.url !== MCP_ENDPOINT_PATH) return send(404, jsonRpcError(null, new McpGatewayError(-32601, "MCP endpoint not found", 404)));
    if (!allowedOrigin(request.headers.origin)) return send(403, jsonRpcError(null, new McpGatewayError(-32003, "Origin is not allowed", 403)));

    if (request.method === "GET") {
      const stored = this.store.status();
      const port = this.address?.port || stored.port;
      const html = this.#renderDiscoveryHtml(port, stored);
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      return response.end(html);
    }

    if (request.method !== "POST") return send(405, jsonRpcError(null, new McpGatewayError(-32601, "Only POST is supported for JSON-RPC", 405)), { Allow: "GET, POST" });
    const authorization = request.headers.authorization || "";
    let expected;
    try { expected = `Bearer ${this.store.token()}`; }
    catch (error) { return send(503, jsonRpcError(null, new McpGatewayError(-32004, error.message, 503))); }
    if (!timingSafeTokenMatch(authorization, expected)) {
      this.#audit({ kind: "authentication", outcome: "denied", client: request.socket?.remoteAddress || "unknown" });
      return send(401, jsonRpcError(null, new McpGatewayError(-32002, "Authentication required", 401)), { "WWW-Authenticate": "Bearer realm=\"OUTARCH MCP\"" });
    }
    if (this.activeRequests >= MAX_MCP_CONCURRENT_REQUESTS) return send(429, jsonRpcError(null, new McpGatewayError(-32005, "MCP gateway is busy", 429)), { "Retry-After": "1" });
    this.activeRequests++;
    let bytes = 0;
    const chunks = [];
    let requestId = null;
    try {
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > MAX_MCP_REQUEST_BYTES) throw new McpGatewayError(-32600, "MCP request exceeds the 256 KiB limit", 413);
        chunks.push(chunk);
      }
      if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
        throw new McpGatewayError(-32600, "MCP requests require application/json", 415);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw new McpGatewayError(-32700, "Invalid JSON", 400); }
      if (typeof body?.id === "string" || typeof body?.id === "number") requestId = body.id;
      const protocolVersion = request.headers["mcp-protocol-version"] || body.params?.protocolVersion || MCP_LEGACY_VERSIONS[0];
      if (!MCP_SUPPORTED_VERSIONS.includes(protocolVersion)) {
        throw new McpGatewayError(-32006, `Unsupported MCP protocol version: ${protocolVersion}`, 400, { supported: [...MCP_SUPPORTED_VERSIONS] });
      }
      if (protocolVersion === MCP_PROTOCOL_VERSION) this.#validateModernHeaders(request, body);
      const result = await this.dispatchRequest(body, { protocolVersion, client: request.headers["x-mission-control-client"] });
      if (body.id === undefined) return send(202, null);
      return send(200, { jsonrpc: "2.0", id: body.id, result });
    } catch (error) {
      const gatewayError = error instanceof McpGatewayError ? error : new McpGatewayError(-32603, error instanceof Error ? error.message : String(error), 500);
      return send(gatewayError.status, jsonRpcError(requestId, gatewayError));
    } finally {
      this.activeRequests--;
      this.#emitStatus();
    }
  }
}

module.exports = {
  CLIENT_LABELS,
  withCodexServer,
  withoutCodexServer,
  CLIENT_ACTIVE_WINDOW_MS,
  MAX_MCP_CONCURRENT_REQUESTS,
  MAX_MCP_REQUEST_BYTES,
  MCP_APPROVAL_TTL_MS,
  MCP_ENDPOINT_PATH,
  MCP_LEGACY_VERSIONS,
  MCP_PROTOCOL_VERSION,
  MCP_SUPPORTED_VERSIONS,
  RESOURCE_DEFINITIONS,
  SecureMcpGateway,
  TOOL_DEFINITIONS,
  allowedOrigin,
  decodeHeaderValue,
  timingSafeTokenMatch
};
