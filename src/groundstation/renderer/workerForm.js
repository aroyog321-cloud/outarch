const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredText(value, label, maximum) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > maximum) throw new Error(`${label} cannot exceed ${maximum} characters`);
  if (text.includes("\0")) throw new Error(`${label} cannot contain null bytes`);
  return text;
}

export function parseWorkerArguments(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Arguments must be a valid JSON array");
  }
  if (!Array.isArray(parsed) || parsed.some(argument => typeof argument !== "string")) {
    throw new Error("Arguments must be a JSON array of strings");
  }
  if (parsed.length > 128) throw new Error("Arguments cannot contain more than 128 entries");
  if (parsed.some(argument => argument.includes("\0"))) {
    throw new Error("Arguments cannot contain null bytes");
  }
  return parsed;
}

export function parseWorkerEnvironment(value) {
  const text = String(value || "").trim();
  if (!text) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Environment must be a valid JSON object");
  }
  if (!plainObject(parsed)) throw new Error("Environment must be a JSON object of string values");
  const entries = Object.entries(parsed);
  if (entries.length > 256) throw new Error("Environment cannot contain more than 256 entries");
  for (const [key, entry] of entries) {
    if (!key || key.includes("=") || key.includes("\0")) {
      throw new Error("Environment keys cannot be empty or contain equals signs or null bytes");
    }
    if (typeof entry !== "string") throw new Error("Environment values must be strings");
    if (entry.includes("\0")) throw new Error("Environment values cannot contain null bytes");
  }
  return parsed;
}

export function buildWorkerDefinition(draft) {
  const rawId = draft?.id ? String(draft.id).trim() : nextAvailableWorkerId(draft?.name || "worker");
  const id = requiredText(rawId, "Worker ID", 64);
  if (!SESSION_ID_PATTERN.test(id)) {
    throw new Error("Worker ID may use only letters, numbers, dots, dashes, and underscores");
  }
  const name = requiredText(draft?.name || id, "Name", 80);
  const command = requiredText(draft?.command, "Command", 4096);
  const cwd = requiredText(draft?.cwd || ".", "Working directory", 4096);
  const args = parseWorkerArguments(draft?.argsText);
  const env = parseWorkerEnvironment(draft?.envText);
  if (draft?.powershellCompatibility && !args.length && /\s/.test(command)) {
    throw new Error("PowerShell compatibility requires an executable command and a separate arguments array");
  }
  return {
    id,
    name,
    command,
    args,
    cwd,
    env,
    powershellCompatibility: draft?.powershellCompatibility === true,
    autoStart: draft?.autoStart === true
  };
}

export function buildWorkerPatch(draft) {
  const definition = buildWorkerDefinition(draft);
  const patch = {
    name: definition.name,
    command: definition.command,
    args: definition.args,
    cwd: definition.cwd,
    powershellCompatibility: definition.powershellCompatibility,
    autoStart: definition.autoStart
  };
  if (draft?.replaceEnvironment === true) patch.env = definition.env;
  return patch;
}

// Produce a worker ID that will not collide with an already-registered session.
// The engine rejects a duplicate `def.id` outright, so the create dialog must not
// present one. Comparison is case-insensitive to avoid `terminal`/`Terminal`
// ambiguity even though the engine key match itself is exact.
export function nextAvailableWorkerId(base, existingIds = []) {
  const taken = new Set((existingIds || []).map(id => String(id || "").trim().toLowerCase()).filter(Boolean));
  const root = (String(base || "").trim() || "terminal").replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[^A-Za-z0-9]+/, "") || "terminal";
  if (!taken.has(root.toLowerCase())) return root;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${root}-${Date.now()}`;
}

// A friendly "start command" field changes command semantics: what the person
// types is a shell command line, not an executable plus arguments. Splitting it
// on spaces would break quoting, paths with spaces, PowerShell expressions and
// Windows `.cmd` shims, so the text is passed to the configured shell intact and
// never concatenated with a project path or an environment value.
//
// The shell is left open afterwards, because the intent is an interactive
// terminal that happens to start with a command — a failed command must leave a
// usable prompt and a visible error, not a window that vanishes.
export function buildShellLaunch(commandText, platform = "win32") {
  const text = String(commandText || "").trim();
  if (text.includes("\0")) throw new Error("Start command cannot contain null bytes");
  if (text.length > 4096) throw new Error("Start command cannot exceed 4096 characters");

  if (platform === "win32") {
    const args = ["-NoLogo", "-NoProfile", "-NoExit"];
    // No command means a plain interactive shell, which is a valid thing to want.
    if (text) args.push("-Command", text);
    return { command: "powershell.exe", args };
  }

  const shell = platform === "darwin" ? "zsh" : "bash";
  if (!text) return { command: shell, args: ["-i"] };
  // `exec` hands the terminal back to an interactive shell once the command
  // finishes, so the pane stays usable either way.
  return { command: shell, args: ["-i", "-c", `${text}; exec ${shell} -i`] };
}

/**
 * The two-field create path: a name and a command line, nothing else. The ID is
 * derived and made collision-safe; the working directory is the open project.
 */
export function buildSimpleWorkerDefinition(draft, { platform = "win32", existingIds = [] } = {}) {
  const name = requiredText(draft?.name, "Name", 80);
  const launch = buildShellLaunch(draft?.startCommand, platform);
  const id = nextAvailableWorkerId(draft?.id || name, existingIds);
  if (!SESSION_ID_PATTERN.test(id)) {
    throw new Error("A worker ID could not be derived from that name; use letters or numbers.");
  }
  return {
    id,
    name,
    command: launch.command,
    args: launch.args,
    cwd: ".",
    env: {},
    powershellCompatibility: false,
    autoStart: false
  };
}

export function initialWorkerDraft(configuration = null) {
  if (!configuration) {
    // Mirror the visibly preselected "Project shell" template so the primary
    // create path submits successfully without an intermediate template click.
    // The create path asks two questions, so the draft starts empty rather than
    // pre-filled with a template's answers.
    return {
      id: "",
      name: "",
      startCommand: "",
      command: "powershell.exe",
      argsText: "[]",
      cwd: ".",
      envText: "{}",
      replaceEnvironment: true,
      powershellCompatibility: false,
      autoStart: false
    };
  }
  return {
    id: configuration.id,
    name: configuration.name || configuration.id,
    startCommand: "",
    command: configuration.command || "",
    argsText: JSON.stringify(configuration.args || [], null, 2),
    cwd: configuration.cwd || ".",
    envText: "{}",
    replaceEnvironment: false,
    powershellCompatibility: configuration.powershellCompatibility === true,
    autoStart: configuration.autoStart === true
  };
}
