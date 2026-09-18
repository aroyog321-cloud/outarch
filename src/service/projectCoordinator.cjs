const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_CONFIG_NAME } = require("../cli/options.cjs");
const { validateWorkspaceFile } = require("../engine/workspaceConfig.cjs");
const { defaultShell } = require("./engineHost.cjs");
const { canonicalPath, projectIdFor } = require("./projectRegistry.cjs");

const MAX_SELECTIONS = 16;
const SELECTION_TTL_MS = 5 * 60 * 1000;

class ProjectCoordinatorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProjectCoordinatorError";
    this.code = code;
    this.details = details;
  }
}

function publicInspection(value) {
  return {
    id: value.id,
    name: value.name,
    rootPath: value.rootPath,
    configPath: value.configPath,
    status: value.status,
    warningCount: value.warningCount || 0,
    error: value.error || null,
    lastOpenedAt: value.lastOpenedAt || null,
    current: value.current === true
  };
}

class ProjectCoordinator {
  constructor(options = {}) {
    if (!options.engineHost) throw new TypeError("ProjectCoordinator requires an engine host");
    if (!options.registry) throw new TypeError("ProjectCoordinator requires a project registry");
    this.engineHost = options.engineHost;
    this.registry = options.registry;
    this.chooseDirectory = typeof options.chooseDirectory === "function"
      ? options.chooseDirectory
      : async () => null;
    this.existsSync = options.existsSync || fs.existsSync;
    this.statSync = options.statSync || fs.statSync;
    this.validateWorkspaceFile = options.validateWorkspaceFile || validateWorkspaceFile;
    this.platform = options.platform || process.platform;
    this.env = options.env || process.env;
    this.now = options.now || Date.now;
    this.configName = options.configName || DEFAULT_CONFIG_NAME;
    this.selections = new Map();
    this.lastWarning = null;
  }

  resolveStartupOptions(options) {
    if (options.configExplicit || this.existsSync(options.configPath)) return { ...options };
    for (const project of this.registry.list()) {
      const inspected = this._inspect(project.rootPath, project.configPath, project);
      if (inspected.status === "ready" || inspected.status === "warning") {
        return {
          configPath: project.configPath,
          configExplicit: true,
          cwd: project.rootPath,
          restoredProject: true
        };
      }
    }
    return { ...options };
  }

  rememberCurrent() {
    const workspace = this.engineHost.engineApi?.getWorkspace?.();
    if (!workspace?.persistent || !workspace.path) return null;
    const remembered = this.registry.remember({
      name: workspace.name,
      rootPath: workspace.directory || path.dirname(workspace.path),
      configPath: workspace.path
    }, this.now());
    this.lastWarning = null;
    return remembered;
  }

  list() {
    const workspace = this.engineHost.engineApi?.getWorkspace?.();
    const currentPath = workspace?.path ? canonicalPath(workspace.path, this.platform) : null;
    return {
      currentProjectId: currentPath ? projectIdFor(currentPath, this.platform) : null,
      registryError: this.lastWarning || this.registry.loadError,
      projects: this.registry.list().map(project => publicInspection(this._inspect(
        project.rootPath,
        project.configPath,
        {
          ...project,
          current: currentPath === canonicalPath(project.configPath, this.platform)
        }
      )))
    };
  }

  async choose() {
    const selected = await this.chooseDirectory();
    if (!selected) return { cancelled: true };
    const rootPath = path.resolve(selected);
    const configPath = path.join(rootPath, this.configName);
    const inspection = this._inspect(rootPath, configPath);
    const selectionToken = crypto.randomUUID();
    this._pruneSelections();
    this.selections.set(selectionToken, {
      rootPath,
      configPath,
      expiresAt: this.now() + SELECTION_TTL_MS
    });
    while (this.selections.size > MAX_SELECTIONS) {
      this.selections.delete(this.selections.keys().next().value);
    }
    return {
      cancelled: false,
      selectionToken,
      project: publicInspection(inspection)
    };
  }

  async open(params = {}) {
    const target = this._resolveTarget(params);
    const inspection = this._inspect(target.rootPath, target.configPath, target);
    if (!['ready', 'warning'].includes(inspection.status)) {
      throw new ProjectCoordinatorError(
        "PROJECT_UNAVAILABLE",
        inspection.error || "project workspace is unavailable"
      );
    }
    const result = await this.engineHost.switchTo({
      configPath: target.configPath,
      configExplicit: true,
      cwd: target.rootPath
    });
    if (!result.ok) {
      throw new ProjectCoordinatorError("PROJECT_SWITCH_FAILED", result.error || "project switch failed", result);
    }
    if (params.selectionToken) this.selections.delete(params.selectionToken);
    let project = null;
    let warning = null;
    try {
      project = this.rememberCurrent();
    } catch (error) {
      warning = error instanceof Error ? error.message : String(error);
      this.lastWarning = warning;
    }
    return {
      changed: result.changed !== false,
      project,
      workspace: this.engineHost.engineApi.getWorkspace(),
      warning
    };
  }

  async initialize(params = {}) {
    const target = this._selection(params.selectionToken);
    const inspection = this._inspect(target.rootPath, target.configPath);
    if (inspection.status !== "uninitialized") {
      throw new ProjectCoordinatorError(
        "PROJECT_ALREADY_INITIALIZED",
        inspection.status === "missing"
          ? "selected project folder is no longer available"
          : "the selected project already has an OUTARCH workspace"
      );
    }
    const name = String(params.name || path.basename(target.rootPath)).trim();
    if (!name) throw new ProjectCoordinatorError("INVALID_PROJECT", "project name is required");
    if (name.length > 80) {
      throw new ProjectCoordinatorError("INVALID_PROJECT", "project name cannot exceed 80 characters");
    }
    this._createWorkspace(target.configPath, name);
    return this.open({ selectionToken: params.selectionToken });
  }

  removeRecent(params = {}) {
    if (typeof params.projectId !== "string" || !params.projectId) {
      throw new ProjectCoordinatorError("INVALID_PROJECT", "projectId is required");
    }
    const currentPath = this.engineHost.engineApi?.getWorkspace?.()?.path;
    if (currentPath && projectIdFor(currentPath, this.platform) === params.projectId) {
      throw new ProjectCoordinatorError("PROJECT_ACTIVE", "the active project cannot be removed from recents");
    }
    return { removed: this.registry.remove(params.projectId) };
  }

  _resolveTarget(params) {
    if (typeof params.projectId === "string" && params.projectId) {
      const project = this.registry.get(params.projectId);
      if (!project) throw new ProjectCoordinatorError("PROJECT_NOT_FOUND", "recent project was not found");
      return project;
    }
    if (typeof params.selectionToken === "string" && params.selectionToken) {
      return this._selection(params.selectionToken);
    }
    throw new ProjectCoordinatorError("INVALID_PROJECT", "projectId or selectionToken is required");
  }

  _selection(token) {
    if (typeof token !== "string" || !token) {
      throw new ProjectCoordinatorError("INVALID_PROJECT", "selectionToken is required");
    }
    this._pruneSelections();
    const selected = this.selections.get(token);
    if (!selected) {
      throw new ProjectCoordinatorError("PROJECT_SELECTION_EXPIRED", "project selection expired; choose the folder again");
    }
    return { ...selected };
  }

  _pruneSelections() {
    const now = this.now();
    for (const [token, selection] of this.selections) {
      if (selection.expiresAt <= now) this.selections.delete(token);
    }
  }

  _inspect(rootPath, configPath, metadata = {}) {
    const base = {
      id: metadata.id || projectIdFor(configPath, this.platform),
      name: metadata.name || path.basename(rootPath),
      rootPath: path.resolve(rootPath),
      configPath: path.resolve(configPath),
      lastOpenedAt: metadata.lastOpenedAt || null,
      current: metadata.current === true
    };
    try {
      if (!this.existsSync(base.rootPath) || !this.statSync(base.rootPath).isDirectory()) {
        return { ...base, status: "missing", error: "project folder is missing" };
      }
      if (!this.existsSync(base.configPath)) {
        return { ...base, status: "uninitialized", error: null };
      }
      const report = this.validateWorkspaceFile(base.configPath);
      const warningCount = report.errors.length + report.commandErrors.length;
      return {
        ...base,
        name: report.workspace.name || base.name,
        status: warningCount ? "warning" : "ready",
        warningCount,
        error: warningCount ? `${warningCount} invalid worker or preset definition${warningCount === 1 ? "" : "s"}` : null
      };
    } catch (error) {
      return {
        ...base,
        status: "invalid",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  _createWorkspace(configPath, name) {
    const shell = defaultShell(this.platform, this.env);
    const definition = {
      version: 1,
      project: { name },
      sessions: [{
        id: "shell",
        name: "Shell",
        command: shell.command,
        ...(shell.args.length ? { args: shell.args } : {}),
        cwd: ".",
        ...(shell.powershellCompatibility ? { powershellCompatibility: true } : {})
      }],
      commands: []
    };
    let descriptor;
    try {
      descriptor = fs.openSync(configPath, "wx", 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify(definition, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
    } catch (error) {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch (closeError) { /* Preserve the create error. */ }
        try { fs.unlinkSync(configPath); } catch (cleanupError) { /* Best effort after partial creation. */ }
      }
      throw new ProjectCoordinatorError(
        "PROJECT_CREATE_FAILED",
        `unable to create OUTARCH workspace: ${error.message}`
      );
    }
  }
}

module.exports = {
  MAX_SELECTIONS,
  ProjectCoordinator,
  ProjectCoordinatorError,
  SELECTION_TTL_MS
};
