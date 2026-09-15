const fs = require("node:fs");
const path = require("node:path");
const { EngineAPI } = require("../engine/index.cjs");
const { validateWorkspaceFile } = require("../engine/workspaceConfig.cjs");
const { acquireWorkspaceLease } = require("../engine/workspaceLease.cjs");

function defaultShell(platform = process.platform, env = process.env) {
  return platform === "win32"
    ? {
        command: "powershell.exe",
        args: ["-NoLogo"],
        powershellCompatibility: true
      }
    : {
        command: env.SHELL || "sh",
        args: [],
        powershellCompatibility: false
      };
}

class EngineHost {
  #EngineAPI;
  #validateWorkspaceFile;
  #acquireWorkspaceLease;
  #existsSync;
  #platform;
  #env;
  #engineOptions;
  #engineApi;
  #workspaceLease;
  #currentOptions;
  #retainedResources;
  #opening;
  #shutdownPromise;
  #switchPromise;

  constructor(options = {}) {
    this.#EngineAPI = options.EngineAPI || EngineAPI;
    this.#validateWorkspaceFile = options.validateWorkspaceFile || validateWorkspaceFile;
    this.#acquireWorkspaceLease = options.acquireWorkspaceLease || acquireWorkspaceLease;
    this.#existsSync = options.existsSync || fs.existsSync;
    this.#platform = options.platform || process.platform;
    this.#env = options.env || process.env;
    this.#engineOptions = options.engineOptions || {};
    this.#engineApi = null;
    this.#workspaceLease = null;
    this.#currentOptions = null;
    this.#retainedResources = [];
    this.#opening = false;
    this.#shutdownPromise = null;
    this.#switchPromise = null;
  }

  get engineApi() {
    return this.#engineApi;
  }

  get isOpen() {
    return Boolean(this.#engineApi);
  }

  get currentOptions() {
    return this.#currentOptions ? { ...this.#currentOptions } : null;
  }

  async open(options = {}) {
    if (this.#engineApi || this.#opening) {
      throw new Error("a workspace is already open in this engine host");
    }
    if (typeof options.configPath !== "string" || !options.configPath.trim()) {
      throw new Error("configPath is required");
    }

    const normalizedOptions = this.#normalizeOptions(options);
    this.#opening = true;
    const { configPath, configExplicit, cwd } = normalizedOptions;
    // Recovery gate: after an unclean shutdown the caller opens the workspace
    // with launches deferred, so every definition loads but nothing respawns
    // until the operator has reviewed what was running. Saved autoStart values
    // are untouched — only this boot is held.
    const engineOptions = options.deferAutoStart === true
      ? { ...this.#engineOptions, deferAutoStart: true }
      : this.#engineOptions;
    let lease = null;
    let engineApi = null;

    try {
      if (this.#existsSync(configPath)) {
        // Invalid roots must fail before the lease or any configured PTY exists.
        this.#validateWorkspaceFile(configPath);
        lease = this.#acquireWorkspaceLease(configPath);
        engineApi = new this.#EngineAPI(engineOptions);
        engineApi.loadProject(configPath);
      } else {
        if (configExplicit) {
          throw new Error(`workspace file does not exist: ${configPath}`);
        }
        engineApi = new this.#EngineAPI(engineOptions);
        const shell = defaultShell(this.#platform, this.#env);
        engineApi.loadProject({
          sessions: [
            {
              id: "shell",
              name: "Shell",
              command: shell.command,
              args: shell.args,
              powershellCompatibility: shell.powershellCompatibility,
              cwd
            }
          ]
        });
      }

      this.#engineApi = engineApi;
      this.#workspaceLease = lease;
      this.#currentOptions = normalizedOptions;
      return engineApi.getState();
    } catch (error) {
      if (engineApi) {
        try {
          const stopped = await engineApi.stopAll();
          if (stopped?.ok === false) {
            // A failed cleanup is still an ownership state. Keep both the
            // engine and lease reachable so a later shutdown can retry; never
            // unlock a workspace while one of its configured PTYs may live.
            this.#engineApi = engineApi;
            this.#workspaceLease = lease;
            this.#currentOptions = normalizedOptions;
          } else {
            try {
              lease?.release();
              engineApi.dispose();
              lease = null;
            } catch (releaseError) {
              this.#engineApi = engineApi;
              this.#workspaceLease = lease;
              this.#currentOptions = normalizedOptions;
            }
          }
        } catch (shutdownError) {
          this.#engineApi = engineApi;
          this.#workspaceLease = lease;
          this.#currentOptions = normalizedOptions;
        }
      }
      if (!engineApi && lease) {
        try {
          lease.release();
        } catch (releaseError) {
          // No EngineAPI exists and therefore no PTY can exist. The exclusive
          // lock is conservative metadata that stale-lock recovery can handle.
        }
      }
      throw error;
    } finally {
      this.#opening = false;
    }
  }

  switchTo(options = {}, timeoutMs) {
    if (this.#switchPromise) {
      return Promise.resolve({ ok: false, error: "a project switch is already in progress" });
    }
    if (!this.#engineApi) {
      return Promise.resolve({ ok: false, error: "no workspace is open" });
    }
    if (this.#shutdownPromise) {
      return Promise.resolve({ ok: false, error: "the engine host is shutting down" });
    }

    this.#switchPromise = this.#performSwitch(options, timeoutMs).finally(() => {
      this.#switchPromise = null;
    });
    return this.#switchPromise;
  }

  async #performSwitch(options, timeoutMs) {
    let normalizedOptions;
    try {
      normalizedOptions = this.#normalizeOptions({ ...options, configExplicit: true });
      if (!this.#existsSync(normalizedOptions.configPath)) {
        return { ok: false, error: `workspace file does not exist: ${normalizedOptions.configPath}` };
      }
      this.#validateWorkspaceFile(normalizedOptions.configPath);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    const currentWorkspace = this.#engineApi.getWorkspace?.();
    const samePath = currentWorkspace?.persistent && currentWorkspace.path && (
      this.#canonicalPath(currentWorkspace.path) === this.#canonicalPath(normalizedOptions.configPath)
    );
    if (samePath) {
      this.#currentOptions = normalizedOptions;
      return { ok: true, changed: false, state: this.#engineApi.getState() };
    }

    const retainedCleanup = await this.#cleanupRetained(timeoutMs);
    if (!retainedCleanup.ok) {
      return {
        ok: false,
        error: retainedCleanup.error || "a previous project switch still owns worker resources",
        pendingIds: retainedCleanup.pendingIds || []
      };
    }

    const previousEngine = this.#engineApi;
    const previousLease = this.#workspaceLease;
    const previousOptions = this.#currentOptions;
    const previouslyRunning = previousEngine.list()
      .filter(session => session.isAlive)
      .map(session => session.id);
    const stopped = await previousEngine.stopAll(timeoutMs);
    if (!stopped.ok) {
      return {
        ...stopped,
        error: stopped.error || "current project workers could not be stopped",
        currentPreserved: true
      };
    }

    let nextLease = null;
    let nextEngine = null;
    try {
      nextLease = this.#acquireWorkspaceLease(normalizedOptions.configPath);
      nextEngine = new this.#EngineAPI(this.#engineOptions);
      nextEngine.loadProject(normalizedOptions.configPath);
    } catch (error) {
      const cleanup = await this.#discardResource(nextEngine, nextLease, timeoutMs);
      const restored = await this.#restoreSessions(previousEngine, previouslyRunning);
      return {
        ok: false,
        error: `unable to open the selected project: ${error instanceof Error ? error.message : String(error)}`,
        currentPreserved: restored.ok,
        restorationErrors: restored.errors,
        pendingIds: cleanup.pendingIds || []
      };
    }

    try {
      previousLease?.release();
    } catch (error) {
      const cleanup = await this.#discardResource(nextEngine, nextLease, timeoutMs);
      const restored = await this.#restoreSessions(previousEngine, previouslyRunning);
      return {
        ok: false,
        error: `unable to release the previous workspace lock: ${error.message}`,
        currentPreserved: restored.ok,
        restorationErrors: restored.errors,
        pendingIds: cleanup.pendingIds || []
      };
    }

    previousEngine.dispose();
    this.#engineApi = nextEngine;
    this.#workspaceLease = nextLease;
    this.#currentOptions = normalizedOptions;
    return { ok: true, changed: true, state: nextEngine.getState(), previousOptions };
  }

  shutdown(timeoutMs) {
    if (this.#switchPromise) {
      return this.#switchPromise.then(
        () => this.shutdown(timeoutMs),
        () => this.shutdown(timeoutMs)
      );
    }
    if (this.#shutdownPromise) return this.#shutdownPromise;
    if (!this.#engineApi && !this.#retainedResources.length) return Promise.resolve({ ok: true });

    const engineApi = this.#engineApi;
    const lease = this.#workspaceLease;
    this.#shutdownPromise = (async () => {
      const retained = await this.#cleanupRetained(timeoutMs);
      const stopped = engineApi ? await engineApi.stopAll(timeoutMs) : { ok: true };
      if (!retained.ok || !stopped.ok) {
        this.#shutdownPromise = null;
        const failure = {
          ok: false,
          pendingIds: [
            ...(Array.isArray(stopped.pendingIds) ? stopped.pendingIds : []),
            ...(Array.isArray(retained.pendingIds) ? retained.pendingIds : [])
          ]
        };
        const error = stopped.error || retained.error;
        if (error) failure.error = error;
        return failure;
      }

      try {
        lease?.release();
      } catch (error) {
        // PTYs are stopped but ownership is still recorded. Keep the host
        // reachable so close can be retried instead of abandoning a lock.
        this.#shutdownPromise = null;
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          pendingIds: []
        };
      }

      engineApi?.dispose();
      this.#engineApi = null;
      this.#workspaceLease = null;
      this.#currentOptions = null;
      this.#shutdownPromise = null;
      return { ok: true };
    })();
    return this.#shutdownPromise;
  }

  #normalizeOptions(options) {
    if (typeof options.configPath !== "string" || !options.configPath.trim()) {
      throw new Error("configPath is required");
    }
    return {
      configPath: path.resolve(options.configPath),
      configExplicit: options.configExplicit === true,
      cwd: path.resolve(options.cwd || process.cwd()),
      ...(options.restoredProject === true ? { restoredProject: true } : {})
    };
  }

  #canonicalPath(value) {
    const absolute = path.resolve(value);
    return this.#platform === "win32" ? absolute.toLowerCase() : absolute;
  }

  async #restoreSessions(engineApi, ids) {
    const errors = [];
    for (const id of ids) {
      try {
        const result = await engineApi.start(id);
        if (!result?.ok) errors.push({ id, error: result?.error || "worker did not restart" });
      } catch (error) {
        errors.push({ id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { ok: errors.length === 0, errors };
  }

  async #discardResource(engineApi, lease, timeoutMs) {
    if (!engineApi && !lease) return { ok: true, pendingIds: [] };
    let stopped = { ok: true };
    if (engineApi) {
      try {
        stopped = await engineApi.stopAll(timeoutMs);
      } catch (error) {
        stopped = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    if (!stopped.ok) {
      this.#retainedResources.push({ engineApi, lease });
      return { ...stopped, pendingIds: stopped.pendingIds || [] };
    }
    try {
      lease?.release();
    } catch (error) {
      this.#retainedResources.push({ engineApi, lease });
      return { ok: false, error: error.message, pendingIds: [] };
    }
    engineApi?.dispose();
    return { ok: true, pendingIds: [] };
  }

  async #cleanupRetained(timeoutMs) {
    if (!this.#retainedResources.length) return { ok: true, pendingIds: [] };
    const retained = this.#retainedResources;
    this.#retainedResources = [];
    const failures = [];
    const pendingIds = [];
    for (const resource of retained) {
      const result = await this.#discardResource(resource.engineApi, resource.lease, timeoutMs);
      if (!result.ok) {
        failures.push(result.error || "retained resource cleanup failed");
        pendingIds.push(...(result.pendingIds || []));
      }
    }
    return failures.length
      ? { ok: false, error: failures.join("; "), pendingIds }
      : { ok: true, pendingIds: [] };
  }
}

module.exports = { EngineHost, defaultShell };
