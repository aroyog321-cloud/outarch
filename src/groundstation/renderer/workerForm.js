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
  const id = requiredText(draft?.id, "Worker ID", 64);
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

export function initialWorkerDraft(configuration = null) {
  if (!configuration) {
    // Mirror the visibly preselected "Project shell" template so the primary
    // create path submits successfully without an intermediate template click.
    return {
      id: "terminal",
      name: "Project shell",
      command: "powershell.exe",
      argsText: "[]",
      cwd: ".",
      envText: "{}",
      replaceEnvironment: true,
      powershellCompatibility: false,
      autoStart: true
    };
  }
  return {
    id: configuration.id,
    name: configuration.name || configuration.id,
    command: configuration.command || "",
    argsText: JSON.stringify(configuration.args || [], null, 2),
    cwd: configuration.cwd || ".",
    envText: "{}",
    replaceEnvironment: false,
    powershellCompatibility: configuration.powershellCompatibility === true,
    autoStart: configuration.autoStart !== false
  };
}
