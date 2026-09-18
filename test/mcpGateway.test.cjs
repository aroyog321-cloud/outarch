const assert = require("node:assert/strict");
const http = require("node:http");
const { test } = require("node:test");
const {
  MCP_PROTOCOL_VERSION,
  SecureMcpGateway,
  allowedOrigin,
  withCodexServer,
  withoutCodexServer
} = require("../src/service/mcpGateway.cjs");

class MemoryStore {
  constructor(scopes = ["context.read", "memory.read", "attention.read"]) {
    this.preferences = { enabled: true, port: 0, scopes };
    this.value = "A".repeat(43);
    this.audit = [];
  }
  status() { return { ...this.preferences, available: true, configured: true, protection: "os-encrypted", backend: "test", auditCount: this.audit.length, error: null }; }
  configure(value) { this.preferences = { ...this.preferences, ...value }; return this.status(); }
  token() { return this.value; }
  rotateToken() { this.value = "B".repeat(43); return this.value; }
  appendAudit(record) { this.audit.push({ ...record }); return record; }
  listAudit(limit) { return this.audit.slice(-(limit || 50)).reverse(); }
}

function fixture(scopes) {
  const actions = [];
  const worker = { id: "api", name: "API", status: "idle", isAlive: false };
  const engine = {
    getSnapshot: id => id === "api" ? { ...worker } : null,
    listRecipes: () => [{ id: "stack", name: "Stack" }],
    getProjectMemory: () => ({ chapters: [{ id: "run-1" }] }),
    listAttention: () => ({ records: [] }),
    start: async id => { actions.push(["start", id]); return { ok: true }; },
    restart: async id => { actions.push(["restart", id]); return { ok: true }; },
    kill: id => { actions.push(["kill", id]); return { ok: true }; },
    acknowledge: id => { actions.push(["acknowledge", id]); return { ok: true }; },
    runRecipe: (id, options) => { actions.push(["runRecipe", id, options]); return { ok: true }; },
    cancelRecipe: id => { actions.push(["cancelRecipe", id]); return { ok: true }; }
  };
  const store = new MemoryStore(scopes);
  const gateway = new SecureMcpGateway({
    store,
    missionContext: { snapshot: options => ({ contextVersion: 1, workers: [{ ...worker, recentOutput: options.includeOutput ? ["bounded"] : undefined }], attention: [], projectMemory: { chapters: [{ id: "run-1" }] }, visibility: { terminalOutput: options.includeOutput ? "sanitized-bounded" : "omitted" } }) },
    projectSupervision: { snapshot: options => ({ supervisionVersion: 1, overview: { whatIsRunning: { summary: "No worker active", items: [] }, whatChanged: { summary: "No changes", items: [] }, whatNeedsYou: { summary: "Nothing needs you", items: [] } }, facts: { workers: [{ ...worker }], history: [], recipes: [{ id: "stack" }], vscode: { connected: false, terminals: [] } }, inferences: [], evidenceIndex: [{ id: "worker:api" }], visibility: { terminalEvidence: options.includeOutput ? "sanitized-bounded" : "omitted" } }) },
    getEngineApi: () => engine,
    randomUUID: (() => { let id = 0; return () => `id-${++id}`; })()
  });
  return { actions, engine, gateway, store };
}

function request(port, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? "" : JSON.stringify(options.body);
    const req = http.request({ hostname: "127.0.0.1", port, path: options.path || "/mcp", method: options.method || "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...(options.headers || {}) } }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: response.statusCode, headers: response.headers, body: text ? JSON.parse(text) : null });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("MCP tool discovery is deterministic and terminal evidence has a separate permission", async t => {
  const { gateway } = fixture(["context.read", "memory.read", "attention.read"]);
  t.after(() => gateway.dispose());
  const listed = await gateway.dispatchRequest({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, { protocolVersion: "2025-11-25" });
  assert.deepEqual(listed.tools.map(tool => tool.name), ["mission_control_supervision", "mission_control_context", "mission_control_worker", "mission_control_memory", "mission_control_attention"]);
  await assert.rejects(
    () => gateway.dispatchRequest({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "mission_control_context", arguments: { includeTerminalEvidence: true } } }, { protocolVersion: "2025-11-25" }),
    /Permission required: terminal.read/
  );
  const read = await gateway.dispatchRequest({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "mission_control_context", arguments: {} } }, { protocolVersion: "2025-11-25" });
  assert.equal(read.structuredContent.visibility.terminalOutput, "omitted");
  const supervised = await gateway.dispatchRequest({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "mission_control_supervision", arguments: {} } }, { protocolVersion: "2025-11-25" });
  assert.equal(supervised.structuredContent.supervisionVersion, 1);
  const resources = await gateway.dispatchRequest({ jsonrpc: "2.0", id: 5, method: "resources/list", params: {} }, { protocolVersion: "2025-11-25" });
  assert.ok(resources.resources.some(resource => resource.uri === "mission-control://vscode/current"));
  const history = await gateway.dispatchRequest({ jsonrpc: "2.0", id: 6, method: "resources/read", params: { uri: "mission-control://history/recent" } }, { protocolVersion: "2025-11-25" });
  assert.deepEqual(JSON.parse(history.contents[0].text), { events: [] });
});

test("MCP mutation tools create approval records and only EngineAPI executes after local approval", async t => {
  const { actions, gateway } = fixture(["context.read", "worker.lifecycle.request", "recipe.run.request"]);
  t.after(() => gateway.dispose());
  const pending = await gateway.dispatchRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "mission_control_request_worker_action", arguments: { workerId: "api", action: "start", reason: "Bring up the API; token=super-secret-value-123456789" } } }, { protocolVersion: "2025-11-25", client: "Claude Desktop" });
  assert.equal(pending.structuredContent.state, "pending");
  assert.equal(pending.structuredContent.reason.includes("super-secret"), false);
  assert.deepEqual(actions, []);
  assert.equal(gateway.status().pendingApprovalCount, 1);

  const resolved = await gateway.resolveApproval(pending.structuredContent.id, "approve");
  assert.equal(resolved.state, "approved");
  assert.deepEqual(actions, [["start", "api"]]);
  assert.equal(gateway.status().pendingApprovalCount, 0);

  const recipe = await gateway.dispatchRequest({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "mission_control_request_recipe_action", arguments: { recipeId: "stack", action: "recover", reason: "Recover the failed startup graph" } } }, { protocolVersion: "2025-11-25" });
  await gateway.resolveApproval(recipe.structuredContent.id, "deny");
  assert.equal(actions.length, 1, "denied approvals must never reach EngineAPI");
});

test("MCP supervisor tools create Mission Supervisor approvals without shell authority", async t => {
  const { gateway } = fixture(["supervisor.plan.request", "worker.create.request", "terminal.input.request"]);
  t.after(() => gateway.dispose());
  const calls = [];
  gateway.missionSupervisor = {
    propose: async value => { calls.push(["propose", value]); return { id: "supervisor-1", state: "pending", plan: { summary: "Plan", actions: [] } }; },
    requestPlan: (plan, metadata) => { calls.push(["requestPlan", plan, metadata]); return { id: `supervisor-${calls.length}`, state: "pending", plan }; }
  };

  const listed = await gateway.dispatchRequest({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, { protocolVersion: "2025-11-25" });
  assert.deepEqual(listed.tools.map(tool => tool.name), [
    "mission_control_plan",
    "mission_control_request_create_worker",
    "mission_control_request_terminal_input"
  ]);
  const planned = await gateway.dispatchRequest({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "mission_control_plan", arguments: { instruction: "Create a web workspace" } } }, { protocolVersion: "2025-11-25", client: "Claude" });
  assert.equal(planned.structuredContent.state, "pending");
  const worker = await gateway.dispatchRequest({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "mission_control_request_create_worker", arguments: { id: "api", name: "API", command: "npm", args: ["run", "dev"], cwd: ".", reason: "Start backend" } } }, { protocolVersion: "2025-11-25", client: "ChatGPT" });
  assert.equal(worker.structuredContent.state, "pending");
  const input = await gateway.dispatchRequest({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "mission_control_request_terminal_input", arguments: { workerId: "api", input: "npm test", reason: "Run verified tests" } } }, { protocolVersion: "2025-11-25", client: "ChatGPT" });
  assert.equal(input.structuredContent.state, "pending");
  assert.deepEqual(calls.map(call => call[0]), ["propose", "requestPlan", "requestPlan"]);
});

test("Secure MCP HTTP transport binds locally, authenticates, validates Origin, and enforces modern metadata headers", async t => {
  const { gateway, store } = fixture(["context.read"]);
  t.after(() => gateway.dispose());
  await gateway.start();
  const port = gateway.status().port;
  assert.equal(gateway.status().host, "127.0.0.1");

  const unauthenticated = await request(port, { body: { jsonrpc: "2.0", id: 1, method: "ping", params: {} } });
  assert.equal(unauthenticated.status, 401);
  assert.match(unauthenticated.headers["www-authenticate"], /Bearer/);

  const blockedOrigin = await request(port, { headers: { Authorization: `Bearer ${store.token()}`, Origin: "https://attacker.example" }, body: { jsonrpc: "2.0", id: 2, method: "ping", params: {} } });
  assert.equal(blockedOrigin.status, 403);

  const body = { jsonrpc: "2.0", id: 3, method: "server/discover", params: { _meta: { "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION, "io.modelcontextprotocol/clientInfo": { name: "Test Client", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} } } };
  const discovered = await request(port, { headers: { Authorization: `Bearer ${store.token()}`, Origin: "http://127.0.0.1:9999", "MCP-Protocol-Version": MCP_PROTOCOL_VERSION, "Mcp-Method": "server/discover" }, body });
  assert.equal(discovered.status, 200);
  assert.equal(discovered.body.result.supportedVersions.includes(MCP_PROTOCOL_VERSION), true);

  const mismatch = await request(port, { headers: { Authorization: `Bearer ${store.token()}`, "MCP-Protocol-Version": MCP_PROTOCOL_VERSION, "Mcp-Method": "tools/list" }, body });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.body.error.code, -32020);
  assert.equal(allowedOrigin("null"), false);
  assert.equal(allowedOrigin("http://localhost:3000"), true);

  const getDiscovery = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: "/mcp", method: "GET" }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(getDiscovery.status, 200);
  assert.match(getDiscovery.headers["content-type"], /text\/html/);
  assert.match(getDiscovery.body, /OUTARCH Secure MCP Gateway/);
  assert.match(getDiscovery.body, /claude_desktop_config\.json/);
});

test("SecureMcpGateway getToken retrieves configured credentials and installClient auto-configures clients", async t => {
  const fsMap = new Map();
  const mockFs = {
    existsSync: p => fsMap.has(p),
    readFileSync: p => fsMap.get(p) || "{}",
    writeFileSync: (p, content) => fsMap.set(p, content),
    mkdirSync: () => {}
  };
  const mockOs = {
    homedir: () => "/mock/home"
  };

  const { gateway, store } = fixture(["context.read"]);
  gateway.fs = mockFs;
  gateway.os = mockOs;
  t.after(() => gateway.dispose());

  const tokenInfo = gateway.getToken();
  assert.equal(tokenInfo.configured, true);
  assert.equal(tokenInfo.token, store.token());
  assert.equal(tokenInfo.authorization, `Bearer ${store.token()}`);

  const claudeCodeResult = gateway.installClient({ target: "claude-code" });
  assert.equal(claudeCodeResult.ok, true);
  assert.match(claudeCodeResult.message, /Claude Code/);
  const claudeCodeJson = JSON.parse(fsMap.get(claudeCodeResult.filePath));
  assert.ok(claudeCodeJson.mcpServers["mission-control"]);
  assert.equal(claudeCodeJson.mcpServers["mission-control"].command, "npx");

  const claudeDesktopResult = gateway.installClient({ target: "claude-desktop" });
  assert.equal(claudeDesktopResult.ok, true);
  assert.match(claudeDesktopResult.message, /Claude Desktop/);

  const cursorResult = gateway.installClient({ target: "cursor", workspacePath: "/mock/workspace" });
  assert.equal(cursorResult.ok, true);
  assert.match(cursorResult.message, /Cursor/);
  const cursorJson = JSON.parse(fsMap.get(cursorResult.filePath));
  assert.equal(cursorJson.mcpServers["mission-control"].type, "http");
  assert.equal(cursorJson.mcpServers["mission-control"].headers.Authorization, `Bearer ${store.token()}`);

  const codexResult = gateway.installClient({ target: "codex" });
  assert.equal(codexResult.ok, true);
  assert.match(codexResult.message, /Codex CLI/);
  const codexContent = fsMap.get(codexResult.filePath);
  assert.match(codexContent, /\[mcp_servers\.mission-control\]/);

  const geminiResult = gateway.installClient({ target: "gemini-cli" });
  assert.equal(geminiResult.ok, true);
  assert.match(geminiResult.message, /Gemini CLI/);

  // Test clientStatus
  const statusMap = gateway.clientStatus({ workspacePath: "/mock/workspace" });
  assert.equal(statusMap["claude-code"].installed, true);
  assert.equal(statusMap["claude-desktop"].installed, true);
  assert.equal(statusMap.cursor.installed, true);
  assert.equal(statusMap.codex.installed, true);
  assert.equal(statusMap["gemini-cli"].installed, true);

  // Test removeClient
  const removeClaude = gateway.removeClient({ target: "claude-code" });
  assert.equal(removeClaude.ok, true);
  assert.equal(removeClaude.removed, true);
  const updatedClaudeJson = JSON.parse(fsMap.get(claudeCodeResult.filePath));
  assert.equal(updatedClaudeJson.mcpServers?.["mission-control"], undefined);

  const removeCodex = gateway.removeClient({ target: "codex" });
  assert.equal(removeCodex.ok, true);
  assert.equal(removeCodex.removed, true);
  const updatedCodex = fsMap.get(codexResult.filePath);
  assert.equal(/\[mcp_servers\.mission-control\]/.test(updatedCodex), false);

  const removeCursor = gateway.removeClient({ target: "cursor", workspacePath: "/mock/workspace" });
  assert.equal(removeCursor.ok, true);
  assert.equal(removeCursor.removed, true);

  const updatedStatusMap = gateway.clientStatus({ workspacePath: "/mock/workspace" });
  assert.equal(updatedStatusMap["claude-code"].installed, false);
  assert.equal(updatedStatusMap.codex.installed, false);
  assert.equal(updatedStatusMap.cursor.installed, false);
  assert.equal(updatedStatusMap["claude-desktop"].installed, true);
});

test("withoutCodexServer cleanly strips mission-control server from TOML while preserving other sections", () => {
  const initial = [
    'model = "gpt-4"',
    "",
    "[mcp_servers.other-tool]",
    'command = "other"',
    'args = ["arg1"]',
    "",
    "[mcp_servers.mission-control]",
    'command = "npx"',
    'args = ["-y", "mcp-remote", "http://127.0.0.1:37421/mcp"]',
    ""
  ].join("\n");

  const stripped = withoutCodexServer(initial);
  assert.equal(/mcp_servers\.mission-control/.test(stripped), false);
  assert.match(stripped, /model = "gpt-4"/);
  assert.match(stripped, /\[mcp_servers\.other-tool\]/);
});


