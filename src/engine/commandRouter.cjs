// safe: runs immediately, nothing to confirm.
// reversible: runs immediately, no prompt — restarting isn't costly to undo.
// destructive: the public Protocol connection requires a server-issued,
// single-use token bound to the exact action payload before dispatch reaches
// this router. Client-specific user ceremonies happen before token issuance.
// The router remains a risk classifier and EngineAPI dispatcher; callers that
// bypass Protocol are trusted in-process code and must enforce the same policy.

const RISK_TIER = {
  start: "reversible",
  restart: "reversible",
  write: "safe",
  kill: "destructive",
  rename: "safe",
  resize: "safe",
  create: "reversible",
  remove: "destructive",
  acknowledge: "safe",
  setAutoStart: "safe",
  reconfigure: "safe",
  instantiateSavedCommand: "reversible",
};

class CommandRouter {
  constructor(engineApi) {
    this.engine = engineApi;
  }

  riskTier(actionType) {
    return RISK_TIER[actionType] || "reversible";
  }

  async dispatch(id, action) {
    if (!action || typeof action.type !== "string") {
      return { ok: false, error: "action type is required" };
    }

    if (action.type === "create") {
      return this.engine.create(action.definition);
    }

    if (action.type === "instantiateSavedCommand") {
      return this.engine.createFromSavedCommand(action.commandId);
    }

    if (!this.engine.getSnapshot(id)) return { ok: false, error: `no such session: ${id}` };

    switch (action.type) {
      case "start":
        return this.engine.start(id);
      case "restart":
        return this.engine.restart(id);
      case "kill":
        return this.engine.kill(id);
      case "write": {
        const written = this.engine.write(id, action.data);
        return written ? { ok: true } : { ok: false, error: "session is not running or write failed" };
      }
      case "rename": {
        return this.engine.rename(id, action.name);
      }
      case "resize": {
        const resized = this.engine.resize(id, action.cols, action.rows);
        return resized ? { ok: true } : { ok: false, error: "session is not running or resize failed" };
      }
      case "remove":
        return this.engine.remove(id);
      case "acknowledge":
        return this.engine.acknowledge(id);
      case "setAutoStart":
        return this.engine.setAutoStart(id, action.enabled);
      case "reconfigure":
        return this.engine.reconfigure(id, action.patch);
      default:
        return { ok: false, error: `unknown action type: ${action.type}` };
    }
  }
}

module.exports = { CommandRouter, RISK_TIER };
