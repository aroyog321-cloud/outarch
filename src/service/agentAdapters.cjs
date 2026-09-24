const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const AGENT_ADAPTERS = Object.freeze([
  Object.freeze({ id: "claude", name: "Claude Code", command: "claude", description: "Anthropic's local coding agent CLI" }),
  Object.freeze({ id: "codex", name: "Codex", command: "codex", description: "OpenAI's local coding agent CLI" }),
  Object.freeze({ id: "gemini", name: "Gemini CLI", command: "gemini", description: "Google's local coding agent CLI" }),
  Object.freeze({ id: "antigravity", name: "Antigravity CLI", command: "agy", description: "Google's terminal coding agent, Gemini CLI's successor" }),
  Object.freeze({ id: "opencode", name: "OpenCode", command: "opencode", description: "Provider-neutral local coding agent CLI" })
]);

function resolveAdapterCommand(command, options = {}) {
  if (typeof options.resolveCommand === "function") return options.resolveCommand(command);
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const pathValue = env.PATH || env.Path || env.path || "";
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const extensions = platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const directory of pathValue.split(pathApi.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = pathApi.join(directory, `${command}${extension}`);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* Keep searching PATH. */ }
    }
  }
  return null;
}

function listAgentAdapters(options = {}) {
  return AGENT_ADAPTERS.map(({ id, name, command, description }) => ({
    id,
    name,
    command,
    description,
    available: Boolean(resolveAdapterCommand(command, options))
  }));
}

function createAgentDefinition(adapterId, options = {}) {
  const adapter = AGENT_ADAPTERS.find(candidate => candidate.id === adapterId);
  if (!adapter) throw new Error(`unsupported agent adapter: ${adapterId}`);
  const platform = options.platform || process.platform;
  const resolved = resolveAdapterCommand(adapter.command, options);
  if (!resolved) throw new Error(`${adapter.name} CLI was not found on PATH; install or configure ${adapter.command} before adding this agent`);
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
  const windowsShim = platform === "win32" && /\.(?:cmd|bat)$/i.test(resolved);
  return {
    id: `agent-${adapter.id}-${suffix}`,
    name: `${adapter.name} agent`,
    command: windowsShim ? (options.comSpec || process.env.ComSpec || "cmd.exe") : resolved,
    args: windowsShim ? ["/d", "/s", "/c", adapter.command] : [],
    cwd: ".",
    autoStart: false
  };
}

module.exports = { AGENT_ADAPTERS, createAgentDefinition, listAgentAdapters, resolveAdapterCommand };
