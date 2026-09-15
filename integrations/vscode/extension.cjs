const crypto = require("node:crypto");
const net = require("node:net");
const vscode = require("vscode");
const { canonicalPath, projectId, projectRelativePath, resolveProjectFile } = require("./bridgeModel.cjs");

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_DIAGNOSTICS = 50;
const CAPABILITIES = Object.freeze([
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

let socket = null;
let authenticated = false;
let activeRoot = null;
let buffer = "";
let statusItem = null;
let snapshotTimer = null;
let gitTimer = null;
let gitDisposables = [];
let extensionContext = null;
let grantedCapabilities = [];
const terminalIds = new WeakMap();
const managedTerminals = new Map();
const terminalActivity = new Map();

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

function workspaceForProject(id) {
  return (vscode.workspace.workspaceFolders || []).find(folder => projectId(folder.uri.fsPath) === id) || null;
}

function relativeFile(uri) {
  if (!activeRoot || uri?.scheme !== "file") return null;
  return projectRelativePath(activeRoot, uri.fsPath);
}

function setStatus(state, detail = "") {
  if (!statusItem) return;
  if (state === "connected") {
    statusItem.text = "$(radio-tower) Mission Control";
    statusItem.tooltip = detail || "Editor context is synchronized with Mission Control";
    statusItem.backgroundColor = undefined;
  } else if (state === "connecting") {
    statusItem.text = "$(sync~spin) Mission Control";
    statusItem.tooltip = "Authenticating with the local Groundstation";
    statusItem.backgroundColor = undefined;
  } else {
    statusItem.text = "$(debug-disconnect) Mission Control";
    statusItem.tooltip = detail || "Mission Control Bridge is disconnected";
    statusItem.backgroundColor = undefined;
  }
  statusItem.show();
}

function send(message) {
  if (!socket || socket.destroyed || (!authenticated && message.type !== "hello")) return false;
  const data = `${JSON.stringify(message)}\n`;
  if (Buffer.byteLength(data, "utf8") > MAX_MESSAGE_BYTES) return false;
  socket.write(data);
  return true;
}

function disconnect(detail = "Disconnected") {
  authenticated = false;
  activeRoot = null;
  grantedCapabilities = [];
  buffer = "";
  if (snapshotTimer) clearTimeout(snapshotTimer);
  if (gitTimer) clearTimeout(gitTimer);
  snapshotTimer = null;
  gitTimer = null;
  for (const disposable of gitDisposables.splice(0)) disposable.dispose?.();
  const current = socket;
  socket = null;
  current?.destroy();
  setStatus("disconnected", detail);
}

function scheduleSnapshot() {
  if (!authenticated || snapshotTimer) return;
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    sendEditorState();
    sendDiagnostics();
    sendTerminalState();
  }, 80);
}

function sendEditorState(savedDocument = null) {
  const editor = vscode.window.activeTextEditor;
  const relativePath = relativeFile(editor?.document?.uri);
  if (!relativePath) {
    send({ type: "editor:state" });
    return;
  }
  const position = editor.selection?.active;
  send({
    type: "editor:state",
    relativePath,
    line: (position?.line || 0) + 1,
    column: (position?.character || 0) + 1,
    languageId: String(editor.document.languageId || "").slice(0, 64),
    dirty: editor.document.isDirty === true,
    savedAt: savedDocument === editor.document ? Date.now() : null
  });
}

function severityName(severity) {
  if (severity === vscode.DiagnosticSeverity.Error) return "error";
  if (severity === vscode.DiagnosticSeverity.Warning) return "warning";
  if (severity === vscode.DiagnosticSeverity.Hint) return "hint";
  return "information";
}

function sendDiagnostics() {
  const counts = { errors: 0, warnings: 0, information: 0, hints: 0 };
  const items = [];
  for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
    const relativePath = relativeFile(uri);
    if (!relativePath) continue;
    for (const diagnostic of diagnostics) {
      const severity = severityName(diagnostic.severity);
      if (severity === "error") counts.errors++;
      else if (severity === "warning") counts.warnings++;
      else if (severity === "hint") counts.hints++;
      else counts.information++;
      if (items.length < MAX_DIAGNOSTICS) items.push({
        relativePath,
        line: diagnostic.range.start.line + 1,
        severity,
        code: diagnostic.code === undefined ? null : String(typeof diagnostic.code === "object" ? diagnostic.code.value : diagnostic.code).slice(0, 80),
        message: String(diagnostic.message || "").slice(0, 240)
      });
    }
  }
  send({ type: "diagnostics", ...counts, items });
}

function terminalId(terminal) {
  let id = terminalIds.get(terminal);
  if (!id) {
    id = `terminal-${crypto.randomUUID()}`;
    terminalIds.set(terminal, id);
  }
  return id;
}

function terminalOwnership(terminal, id) {
  const managed = managedTerminals.get(id);
  return managed?.terminal === terminal && activeRoot && managed.root === canonicalPath(activeRoot)
    ? "mission-control-managed"
    : "vscode-owned";
}

function safeCommand(value) {
  const command = String(value || "").replace(/[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, 240);
  if (!command) return null;
  if (/(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret|token)\s*(?:=|:)/i.test(command)) {
    return "[command hidden: possible secret]";
  }
  if (/\b(?:AIza[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,})\b/.test(command)) {
    return "[command hidden: possible secret]";
  }
  return command;
}

function terminalCwd(terminal) {
  const uri = terminal.shellIntegration?.cwd;
  if (!activeRoot || uri?.scheme !== "file") return null;
  if (canonicalPath(uri.fsPath) === canonicalPath(activeRoot)) return ".";
  return projectRelativePath(activeRoot, uri.fsPath);
}

function sendTerminalState() {
  send({
    type: "terminals:state",
    terminals: vscode.window.terminals.slice(0, 32).map(terminal => {
      const id = terminalId(terminal);
      const activity = terminalActivity.get(id);
      return {
        id,
        name: String(terminal.name || "Terminal").slice(0, 120),
        state: "open",
        ownership: terminalOwnership(terminal, id),
        active: vscode.window.activeTerminal === terminal,
        shellIntegration: Boolean(terminal.shellIntegration),
        currentCommand: safeCommand(activity?.command),
        commandState: activity?.state || "idle",
        cwd: terminalCwd(terminal)
      };
    })
  });
}

function scheduleGit(repository) {
  if (!authenticated || gitTimer) return;
  gitTimer = setTimeout(() => {
    gitTimer = null;
    const root = repository?.rootUri?.fsPath;
    if (!root || canonicalPath(root) !== canonicalPath(activeRoot)) return;
    const state = repository.state;
    const head = state.HEAD;
    const changedPaths = new Set([
      ...(state.indexChanges || []),
      ...(state.workingTreeChanges || []),
      ...(state.mergeChanges || [])
    ].map(change => change.uri?.fsPath).filter(Boolean)).size;
    send({
      type: "git:state",
      branch: String(head?.name || "").slice(0, 160) || null,
      changedPaths,
      ahead: Number.isInteger(head?.ahead) ? head.ahead : 0,
      behind: Number.isInteger(head?.behind) ? head.behind : 0,
      clean: changedPaths === 0
    });
  }, 100);
}

async function connectGit() {
  for (const disposable of gitDisposables.splice(0)) disposable.dispose?.();
  const extension = vscode.extensions.getExtension("vscode.git");
  if (!extension) return;
  try {
    const exports = extension.isActive ? extension.exports : await extension.activate();
    const api = exports?.getAPI?.(1);
    if (!api) return;
    const observe = repository => {
      gitDisposables.push(repository.state.onDidChange(() => scheduleGit(repository)));
      scheduleGit(repository);
    };
    for (const repository of api.repositories || []) observe(repository);
    gitDisposables.push(api.onDidOpenRepository(observe));
  } catch {
    // Git synchronization is additive; editor context remains connected.
  }
}

async function openFile(message) {
  if (!activeRoot || typeof message.relativePath !== "string") return;
  const realFile = resolveProjectFile(activeRoot, message.relativePath);
  if (!realFile) return;
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(realFile));
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const line = Math.max(0, Math.min(document.lineCount - 1, Number(message.line || 1) - 1));
  const column = Math.max(0, Number(message.column || 1) - 1);
  const position = new vscode.Position(line, column);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function hasPermission(capability) {
  return grantedCapabilities.includes(capability);
}

function managedTerminal(message) {
  const id = typeof message.terminalId === "string" ? message.terminalId : "";
  const record = managedTerminals.get(id);
  if (record && record.root === canonicalPath(activeRoot) && vscode.window.terminals.includes(record.terminal)) {
    return { id, terminal: record.terminal };
  }
  const match = (vscode.window.terminals || []).find(t => terminalId(t) === id);
  if (match && activeRoot) {
    return { id, terminal: match };
  }
  throw new Error("This terminal is not managed by Mission Control in the active project");
}

async function runTerminalCommand(message) {
  const requestId = typeof message.requestId === "string" ? message.requestId.slice(0, 80) : "";
  if (!requestId) return;
  try {
    let id = null;
    if (message.type === "command:terminal-create") {
      if (!hasPermission("terminals.manage")) throw new Error("Terminal management permission was not granted");
      const name = String(message.name || "Mission Control").trim().slice(0, 80) || "Mission Control";
      const cwd = String(message.cwd || ".");
      const resolved = cwd === "." ? activeRoot : resolveProjectFile(activeRoot, cwd);
      if (!resolved) throw new Error("Terminal cwd is outside the active project");
      const terminal = vscode.window.createTerminal({ name, cwd: vscode.Uri.file(resolved) });
      id = terminalId(terminal);
      managedTerminals.set(id, { terminal, root: canonicalPath(activeRoot) });
      terminal.show(false);
    } else if (message.type === "command:terminal-write") {
      if (!hasPermission("terminals.input.write")) throw new Error("Terminal input permission was not granted");
      const managed = managedTerminal(message);
      const input = typeof message.input === "string" ? message.input : "";
      if (!input || Buffer.byteLength(input, "utf8") > 4096 || /[\0\r\n]/.test(input)) throw new Error("Terminal input is invalid or too large");
      managed.terminal.sendText(input, message.addNewLine !== false);
      send({ type: "terminal:output", terminalId: managed.id, input });
      id = managed.id;
    } else if (message.type === "command:terminal-focus") {
      if (!hasPermission("terminals.manage")) throw new Error("Terminal management permission was not granted");
      const managed = managedTerminal(message);
      managed.terminal.show(false);
      id = managed.id;
    } else if (message.type === "command:terminal-close") {
      if (!hasPermission("terminals.manage")) throw new Error("Terminal management permission was not granted");
      const managed = managedTerminal(message);
      managed.terminal.dispose();
      managedTerminals.delete(managed.id);
      terminalActivity.delete(managed.id);
      id = managed.id;
    } else {
      return;
    }
    send({ type: "command:result", requestId, ok: true, terminalId: id });
    scheduleSnapshot();
  } catch (error) {
    send({ type: "command:result", requestId, ok: false, error: String(error?.message || error).slice(0, 240) });
  }
}

function handleFrame(message) {
  if (!message || typeof message !== "object") return;
  if (!authenticated) {
    if (message.type !== "hello:ack" || message.protocolVersion !== PROTOCOL_VERSION) {
      disconnect("Groundstation rejected the handshake");
      return;
    }
    authenticated = true;
    grantedCapabilities = Array.isArray(message.permissions) ? message.permissions.filter(value => CAPABILITIES.includes(value)) : [];
    setStatus("connected", `${message.project?.name || "Project"} is synchronized`);
    scheduleSnapshot();
    void connectGit();
    return;
  }
  if (message.type === "command:open-file") void openFile(message).catch(() => {});
  else if (message.type === "command:open-problems") void vscode.commands.executeCommand("workbench.actions.view.problems");
  else if (["command:terminal-create", "command:terminal-write", "command:terminal-focus", "command:terminal-close"].includes(message.type)) void runTerminalCommand(message);
  else if (message.type === "disconnect") disconnect(`Mission Control disconnected: ${message.reason || "requested"}`);
  else if (message.type === "ping") send({ type: "pong", at: Date.now() });
}

function handleData(chunk) {
  buffer += String(chunk);
  if (Buffer.byteLength(buffer, "utf8") > MAX_MESSAGE_BYTES) {
    disconnect("Bridge message exceeded its safe limit");
    return;
  }
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    try { handleFrame(JSON.parse(line)); }
    catch { disconnect("Groundstation sent an invalid bridge message"); }
  }
}

async function connectFromUri(uri) {
  const params = new URLSearchParams(uri.query);
  const port = Number(params.get("port"));
  const token = params.get("token");
  const project = params.get("project");
  if (!Number.isInteger(port) || port < 1 || port > 65535 || typeof token !== "string" || token.length < 32 || !/^[a-f0-9]{20}$/.test(project || "")) {
    void vscode.window.showErrorMessage("Mission Control supplied an invalid bridge invitation.");
    return;
  }
  const folder = workspaceForProject(project);
  if (!folder) {
    void vscode.window.showErrorMessage("Open the same project folder in VS Code before connecting Mission Control.");
    return;
  }
  disconnect("Connecting…");
  activeRoot = folder.uri.fsPath;
  setStatus("connecting");
  const clientId = extensionContext.globalState.get("clientId") || crypto.randomUUID();
  await extensionContext.globalState.update("clientId", clientId);
  const connection = net.createConnection({ host: "127.0.0.1", port });
  socket = connection;
  connection.setEncoding("utf8");
  connection.setNoDelay(true);
  const timeout = setTimeout(() => {
    if (!authenticated && socket === connection) disconnect("Groundstation handshake timed out");
  }, 10_000);
  connection.on("connect", () => send({
    type: "hello",
    protocolVersion: PROTOCOL_VERSION,
    token,
    clientId,
    extensionVersion: extensionContext.extension.packageJSON.version,
    workspacePath: activeRoot,
    capabilities: [...CAPABILITIES]
  }));
  connection.on("data", handleData);
  connection.on("error", () => {
    if (socket === connection) disconnect("Mission Control is not accepting bridge connections");
  });
  connection.on("close", () => {
    clearTimeout(timeout);
    if (socket === connection) disconnect("Groundstation connection closed");
  });
}

function activate(context) {
  extensionContext = context;
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 40);
  statusItem.command = "missionControlBridge.connect";
  setStatus("disconnected");
  const terminalActivityDisposables = [];
  if (typeof vscode.window.onDidStartTerminalShellExecution === "function") {
    terminalActivityDisposables.push(vscode.window.onDidStartTerminalShellExecution(async event => {
      const id = terminalId(event.terminal);
      const rawCommand = event.execution?.commandLine?.value || "";
      const command = stripAnsi(rawCommand).trim();
      terminalActivity.set(id, { command, state: "running" });
      send({ type: "terminal:output", terminalId: id, input: command, state: "running" });
      scheduleSnapshot();
      try {
        if (typeof event.execution?.read === "function") {
          const stream = event.execution.read();
          for await (const chunk of stream) {
            const cleaned = stripAnsi(chunk);
            if (cleaned.trim() || cleaned.includes("\n")) {
              send({ type: "terminal:output", terminalId: id, data: cleaned });
            }
          }
        }
      } catch { /* Stream ended or read error */ }
    }));
  }
  if (typeof vscode.window.onDidEndTerminalShellExecution === "function") {
    terminalActivityDisposables.push(vscode.window.onDidEndTerminalShellExecution(event => {
      const id = terminalId(event.terminal);
      const rawCommand = event.execution?.commandLine?.value || terminalActivity.get(id)?.command || "";
      const command = stripAnsi(rawCommand).trim();
      const state = event.exitCode === 0 ? "succeeded" : "failed";
      terminalActivity.set(id, { command, state });
      send({ type: "terminal:output", terminalId: id, state, exitCode: event.exitCode });
      scheduleSnapshot();
    }));
  }
  context.subscriptions.push(
    statusItem,
    vscode.window.registerUriHandler({ handleUri: connectFromUri }),
    vscode.commands.registerCommand("missionControlBridge.connect", () => vscode.window.showInformationMessage("Use Connect VS Code in Mission Control Settings to create a secure invitation.")),
    vscode.commands.registerCommand("missionControlBridge.disconnect", () => disconnect("Disconnected by you")),
    vscode.window.onDidChangeActiveTextEditor(scheduleSnapshot),
    vscode.window.onDidChangeTextEditorSelection(scheduleSnapshot),
    vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document === vscode.window.activeTextEditor?.document) scheduleSnapshot();
    }),
    vscode.workspace.onDidSaveTextDocument(document => sendEditorState(document)),
    vscode.languages.onDidChangeDiagnostics(scheduleSnapshot),
    vscode.window.onDidOpenTerminal(scheduleSnapshot),
    vscode.window.onDidCloseTerminal(terminal => {
      const id = terminalIds.get(terminal);
      if (id) {
        managedTerminals.delete(id);
        terminalActivity.delete(id);
      }
      scheduleSnapshot();
    }),
    vscode.tasks.onDidStartTask(event => send({ type: "task:state", name: event.execution.task.name, state: "started" })),
    vscode.tasks.onDidEndTaskProcess(event => send({ type: "task:state", name: event.execution.task.name, state: event.exitCode === 0 ? "succeeded" : "failed", exitCode: event.exitCode })),
    ...terminalActivityDisposables
  );
}

function deactivate() {
  disconnect("Extension stopped");
  extensionContext = null;
  statusItem = null;
}

module.exports = { activate, deactivate };
