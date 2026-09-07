import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { confirmedRequest, missionApi } from "./missionApi.js";

const MODELS = [
  ["gemini-2.5-flash", "Gemini 2.5 Flash", "Stable · balanced"],
  ["gemini-2.5-pro", "Gemini 2.5 Pro", "Capable · complex"],
  ["gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite", "Fast · economical"],
  ["gemini-2.0-flash", "Gemini 2.0 Flash", "Legacy · fast"]
];

const QUESTIONS = [
  "What is happening?",
  "What is broken?",
  "What needs me?",
  "What changed while I was away?"
];

const PLAN_EXAMPLES = [
  "Create backend and frontend workers, then start backend before frontend.",
  "Design a recipe (a repeatable workspace launch) for database, backend, frontend, tests, and Git.",
  "Restart the failed worker and verify its current state."
];

function actionLabel(action) {
  const target = action.workerId || action.recipeId || action.definition?.id || action.profile?.id || "workspace";
  return `${String(action.type || "action").replaceAll("-", " ")} · ${target}`;
}

function modelLabel(model) {
  return MODELS.find(([id]) => id === model)?.[1] || model || "Gemini 2.5 Flash";
}

function StateMark({ status, resourceState }) {
  if (!status && resourceState.loading) return <span className="mission-ai-state is-idle"><i/><span><small>OBSERVE-ONLY INTELLIGENCE</small><strong>Checking status…</strong></span></span>;
  if (!status && resourceState.error) return <span className="mission-ai-state is-blocked"><i/><span><small>OBSERVE-ONLY INTELLIGENCE</small><strong>Status unavailable</strong></span></span>;
  if (resourceState.error) return <span className="mission-ai-state is-blocked"><i/><span><small>OBSERVE-ONLY INTELLIGENCE</small><strong>Stale status</strong></span></span>;
  const tone = status?.configured ? "ready" : status?.available === false ? "blocked" : "idle";
  const label = status?.configured ? (status.keyState?.secondary?.configured ? "Dual-Key Ready" : "Ready") : status?.available === false ? "Encryption unavailable" : "Not configured";
  return <span className={`mission-ai-state is-${tone}`}><i/><span><small>OBSERVE-ONLY INTELLIGENCE</small><strong>{label}</strong></span></span>;
}

/* T118 - the four states that decide whether Mission AI can answer, each named
   separately so a failure in one is never reported as a failure in another.
   "Not configured" is not "unavailable"; "unavailable" is not "the last request
   failed"; and none of them is "we don't know", which is what a failed status
   read means. No value below is derived from the API key: `configured` is a
   boolean the credential store reports, and the key itself never leaves it. */
function missionAiStates(status, resourceState) {
  if (!status) {
    return [
      { key: "provider", label: "Provider", value: "Gemini", tone: "idle" },
      { key: "credential", label: "Credential", value: resourceState.loading ? "Checking…" : "Unknown - status could not be read", tone: resourceState.error ? "blocked" : "idle" },
      { key: "availability", label: "Protected storage", value: "Unknown", tone: "idle" },
      { key: "request", label: "Last request", value: "Unknown", tone: "idle" }
    ];
  }
  return [
    {
      key: "provider",
      label: "Provider",
      value: `${status.provider === "gemini" || !status.provider ? "Gemini" : status.provider} · ${modelLabel(status.model)} · ${status.authority || "observe"}-only`,
      tone: "ready"
    },
    {
      key: "credential",
      label: "Credential",
      value: status.configured ? "Stored, OS-encrypted on this device" : "Not configured",
      tone: status.configured ? "ready" : "idle"
    },
    {
      key: "availability",
      label: "Protected storage",
      value: status.available === false ? (status.error || "Unavailable on this machine") : "Available",
      tone: status.available === false ? "blocked" : "ready"
    },
    {
      key: "request",
      label: "Last request",
      value: status.lastError
        ? `Failed - ${status.lastError}`
        : status.lastCompletedAt
          ? "Answered"
          : "None yet",
      tone: status.lastError ? "blocked" : status.lastCompletedAt ? "ready" : "idle"
    }
  ];
}

function MissionAIStateFacts({ status, resourceState }) {
  return <dl className="mission-ai-states" aria-label="Mission AI state">
    {missionAiStates(status, resourceState).map(item => <div key={item.key} className={`tone-${item.tone}`}>
      <dt>{item.label}</dt>
      <dd>{item.value}</dd>
    </div>)}
  </dl>;
}

// Mission Supervisor (Gemini plan) approvals render only through the unified
// decision model now (`useDecisions` -> `DecisionList`, which renders `steps`).
// The old per-integration approval queue was unrendered dead code.

export function MissionAISettings({ onOpen, onConfirm }) {
  const [status, setStatus] = React.useState(null);
  const [apiKey, setApiKey] = React.useState("");
  const [apiKeySecondary, setApiKeySecondary] = React.useState("");
  const [model, setModel] = React.useState("gemini-2.5-flash");
  const [includeTerminalEvidence, setIncludeTerminalEvidence] = React.useState(false);
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [resourceState, setResourceState] = React.useState({ loading: true, error: "", updatedAt: null });
  const refresh = React.useCallback(async () => {
    setResourceState(current => ({ ...current, loading: current.updatedAt == null }));
    try {
      const value = await missionApi().request("missionAi.status");
      setStatus(value);
      setModel(value.model || "gemini-2.5-flash");
      setIncludeTerminalEvidence(value.includeTerminalEvidence === true);
      setResourceState({ loading: false, error: "", updatedAt: Date.now() });
    } catch (error) {
      setResourceState(current => ({ ...current, loading: false, error: error.message || String(error) }));
    }
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    setBusy("save");
    setMessage("");
    try {
      const value = await missionApi().request("missionAi.configure", {
        configuration: {
          ...(apiKey ? { apiKey } : {}),
          ...(apiKeySecondary ? { apiKeySecondary } : {}),
          model,
          includeTerminalEvidence
        }
      });
      setApiKey("");
      setApiKeySecondary("");
      setStatus(value);
      setMessage("Mission AI configuration protected by this device.");
    } catch (error) { setMessage(error.message || String(error)); }
    finally { setBusy(""); }
  };

  const clear = async () => {
    setBusy("clear");
    setMessage("");
    try {
      const value = await confirmedRequest("missionAi.clear");
      setApiKey("");
      setApiKeySecondary("");
      setStatus(value.status);
      setMessage(value.removed ? "Gemini credentials removed from this device." : "No Gemini credentials were stored.");
    } catch (error) { setMessage(error.message || String(error)); }
    finally { setBusy(""); }
  };

  const selectedModel = MODELS.find(([id]) => id === model) || MODELS[0];
  const blocked = status?.available === false;
  const statusActionable = Boolean(status) && !resourceState.error;
  return <section className={`pm-page-hero feat-ai ${status?.configured ? "is-configured" : ""}`}>
    <header><div className="mission-ai-heading"><span className="mission-ai-mark">AI</span><div><h3>Gemini Mission Supervisor</h3><p>Ask grounded project questions or generate exact action plans. Dual-key failover ensures continuous operation when free quotas expire.</p></div></div><StateMark status={status} resourceState={resourceState}/></header>
    {resourceState.error && <div className="integration-resource-notice" role="status"><span><strong>Mission AI status could not be refreshed.</strong> {status ? "Showing the last verified configuration; controls are unavailable until it is checked again." : "Configuration is unknown, so Mission Control will not claim it is disabled or ready."}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}
    <MissionAIStateFacts status={status} resourceState={resourceState}/>
    <div className="mission-ai-settings-grid">
      <div className="ai-api-key-banner">
        <label htmlFor="mission-ai-key">
          <span>Gemini API key (Primary)</span>
          <small>{status?.keyState?.primary?.configured ? "Primary key protected on device. Enter a new key to replace it." : status ? "Stored with OS credential encryption—not in project files." : "Credential state is being verified."}</small>
        </label>
        <input id="mission-ai-key" type="password" autoComplete="off" spellCheck="false" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={status?.keyState?.primary?.configured ? "Primary key protected on this device" : "Enter primary Gemini API key"} disabled={!statusActionable || blocked || Boolean(busy)}/>
      </div>
      <div className="ai-api-key-banner">
        <label htmlFor="mission-ai-key-secondary">
          <span>Gemini API key (Secondary Fallback)</span>
          <small>{status?.keyState?.secondary?.configured ? "Secondary key protected on device. Automatically active if primary hits 429 quota limits." : "Optional failover key. Automatically activates on rate limits (429) or auth errors."}</small>
        </label>
        <input id="mission-ai-key-secondary" type="password" autoComplete="off" spellCheck="false" value={apiKeySecondary} onChange={event => setApiKeySecondary(event.target.value)} placeholder={status?.keyState?.secondary?.configured ? "Secondary key protected on this device" : "Enter secondary Gemini API key (optional failover)"} disabled={!statusActionable || blocked || Boolean(busy)}/>
      </div>
      <div className="mission-ai-model"><span>Model</span><DropdownMenu.Root><DropdownMenu.Trigger asChild><button disabled={!statusActionable || blocked || Boolean(busy)}><span><strong>{selectedModel[1]}</strong><small>{selectedModel[2]}</small></span><b>⌄</b></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="mission-ai-model-menu" align="start" sideOffset={7}>{MODELS.map(([id, label, detail]) => <DropdownMenu.Item key={id} className={model === id ? "is-selected" : ""} onSelect={() => setModel(id)}><span><strong>{label}</strong><small>{detail}</small></span><b>{model === id ? "✓" : ""}</b></DropdownMenu.Item>)}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root></div>
      <label className="mission-ai-evidence-permission"><input type="checkbox" checked={includeTerminalEvidence} onChange={event => setIncludeTerminalEvidence(event.target.checked)} disabled={!statusActionable || blocked || Boolean(busy)}/><span><strong>Include bounded terminal evidence</strong><small>Explicit permission. Recent output is redacted and size-limited; it remains omitted by default.</small></span><i/></label>
      <aside><span>AUTHORITY BOUNDARY</span><ul><li>Healthy live evidence only when permitted</li><li>Stateless provider requests; server storage disabled</li><li>Structured plans are validated locally</li><li>Automatic secondary key failover on 429 quota exhaustion</li><li>Terminal input requires exact local approval</li></ul></aside>
    </div>
    {status?.error && <p className="mission-ai-message is-error" role="alert">{status.error}</p>}
    {message && <p className="mission-ai-message" role="status">{message}</p>}
    <footer><span>{!status ? "Mission AI configuration has not been verified." : blocked ? "Mission Control refuses plaintext credential storage on this device." : status.configured ? `${modelLabel(status.model)} · terminal evidence ${status.includeTerminalEvidence ? "permitted" : "omitted"}` : "An API key is required before Mission AI can answer."}</span><div>{status?.configured && <button className="mission-ai-ask" onClick={onOpen} disabled={!statusActionable || Boolean(busy)}>Ask Mission AI</button>}<button className="mission-ai-clear" disabled={!statusActionable || !status?.configured || Boolean(busy) || !onConfirm} onClick={() => onConfirm?.({ title: "Remove the Gemini API key?", detail: "The OS-encrypted credentials will be deleted from this device.", recovery: "You can configure Mission AI again later.", confirmLabel: "Remove key", run: clear })}>Remove key</button><button className="mission-ai-save" disabled={!statusActionable || blocked || Boolean(busy) || (!status?.configured && !apiKey && !apiKeySecondary)} onClick={() => void save()}>{busy === "save" ? "Protecting…" : status?.configured ? "Save preferences" : "Protect & enable"}</button></div></footer>
  </section>;
}

export function MissionAIOverlay({ open, onClose, onConfigure, onNeedsYou, onEvidence, initialPrompt = "" }) {
  const [status, setStatus] = React.useState(null);
  const [mode, setMode] = React.useState("ask");
  const [question, setQuestion] = React.useState(QUESTIONS[0]);
  const [answer, setAnswer] = React.useState(null);
  const [proposal, setProposal] = React.useState(null);
  const [turns, setTurns] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    let active = true;
    missionApi().request("missionAi.status").then(value => { if (active) setStatus(value); }).catch(value => { if (active) setError(value.message || String(value)); });
    return () => { active = false; };
  }, [open]);

  React.useEffect(() => {
    if (!open || !initialPrompt) return;
    setMode("ask");
    setQuestion(initialPrompt.slice(0, 1200));
    setAnswer(null);
    setProposal(null);
    setError("");
  }, [initialPrompt, open]);

  const ask = async () => {
    if (!question.trim() || busy) return;
    const submittedQuestion = question.trim();
    setBusy(true);
    setError("");
    setAnswer(null);
    try {
      const value = await missionApi().request("missionAi.ask", { question: submittedQuestion });
      setAnswer(value);
      setTurns(current => [...current, { id: `${Date.now()}-answer`, mode: "ask", prompt: submittedQuestion, answer: value }]);
    }
    catch (value) { setError(value.message || String(value)); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (mode === "ask") return ask();
    if (!question.trim() || busy) return;
    const submittedQuestion = question.trim();
    setBusy(true);
    setError("");
    setAnswer(null);
    setProposal(null);
    try {
      const value = await missionApi().request("missionSupervisor.plan", { instruction: submittedQuestion });
      setProposal(value);
      setTurns(current => [...current, { id: `${Date.now()}-plan`, mode: "plan", prompt: submittedQuestion, proposal: value }]);
    }
    catch (value) { setError(value.message || String(value)); }
    finally { setBusy(false); }
  };

  const configure = () => { onClose(); onConfigure(); };
  const presets = mode === "ask" ? QUESTIONS : PLAN_EXAMPLES;
  return <Dialog.Root open={open} onOpenChange={value => !value && onClose()}><Dialog.Portal><Dialog.Overlay className="palette-backdrop mission-ai-backdrop"/><Dialog.Content className="mission-ai-dialog" aria-describedby="mission-ai-boundary"><header><div><span className="mission-ai-mark">AI</span><span><small>MISSION SUPERVISOR · APPROVAL GATED</small><Dialog.Title>Mission Command</Dialog.Title></span></div><div className="mission-ai-header-actions">{turns.length > 0 && <button onClick={() => { setTurns([]); setAnswer(null); setProposal(null); setError(""); }}>New session</button>}<Dialog.Close asChild><button aria-label="Close Mission AI">×</button></Dialog.Close></div></header>
        {!status?.configured ? <div className="mission-ai-unconfigured"><span className="mission-ai-lock">◇</span><h3>Connect Gemini securely</h3><p>Mission AI needs an OS-encrypted API key before it can interpret the current project snapshot.</p><button onClick={configure}>Open secure settings</button></div> : <><div className="mission-ai-mode" role="group" aria-label="Mission AI mode"><button type="button" aria-pressed={mode === "ask"} className={mode === "ask" ? "is-current" : ""} onClick={() => { setMode("ask"); setQuestion(QUESTIONS[0]); setProposal(null); }}>Ask about project</button><button type="button" aria-pressed={mode === "plan"} className={mode === "plan" ? "is-current" : ""} onClick={() => { setMode("plan"); setQuestion(PLAN_EXAMPLES[0]); setAnswer(null); }}>Plan workspace actions</button></div><div className="gemini-chat"><div className="gemini-chat__messages" aria-label="Earlier turns in this Mission AI session">{turns.length > 1 && turns.slice(0,-1).map(turn => <React.Fragment key={turn.id}><div className="chat-message is-user"><div className="chat-message__avatar">U</div><div className="chat-message__bubble"><p style={{margin: 0}}>{turn.prompt}</p></div></div><div className="chat-message is-ai"><div className="chat-message__avatar">AI</div><div className="chat-message__bubble">{turn.answer ? <><p style={{margin: 0, marginBottom: "8px"}}>{turn.answer.text}</p>{turn.answer.estimate && <small style={{display: "block", color: "var(--mc-text-muted)"}}>Estimate: {turn.answer.estimate.minimumHours}–{turn.answer.estimate.maximumHours} hours</small>}{turn.answer.citations?.length > 0 && <button className="mission-ai-evidence-link" onClick={onEvidence}>Review {turn.answer.citations.length} evidence reference{turn.answer.citations.length === 1 ? "" : "s"} in History</button>}</> : <><p style={{margin: 0}}>{turn.proposal?.plan?.summary}</p><small style={{display: "block", color: "var(--mc-text-muted)", marginTop: "8px"}}>{turn.proposal?.plan?.actions?.length || 0} validated actions · not executed</small></>}</div></div></React.Fragment>)}</div></div><div className="gemini-chat__input-area"><div className="gemini-chat__chips">{presets.map(value => <button key={value} className="gemini-chat__chip" onClick={() => setQuestion(value)}>{value}</button>)}</div><div className="gemini-chat__input-row"><textarea className="gemini-chat__textarea" maxLength="1200" value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void submit(); }} placeholder={mode === "ask" ? "Ask about current state, evidence, impact..." : "Describe workers, order, profile..."}/><button className="btn-primary feat-ai" disabled={busy || !question.trim()} onClick={() => void submit()}>{busy ? "Thinking…" : mode === "ask" ? "Ask" : "Plan"}</button></div></div>
      <div className={`mission-ai-answer ${busy ? "is-busy" : ""}`} aria-live="polite">{busy ? <div className="mission-ai-reading"><i/><span><strong>{mode === "ask" ? "Reading unified project supervision" : "Building a dependency-aware action plan"}</strong><small>{mode === "ask" ? "No worker or terminal action is being performed." : "Gemini cannot execute; local validation and approval follow."}</small></span></div> : proposal ? <div className="mission-ai-proposal"><span className="section-kicker">VALIDATED PLAN · NOT EXECUTED</span><strong>{proposal.plan.summary}</strong><ol>{proposal.plan.actions.map((action, index) => <li key={index}><b>{index + 1}</b><span><strong>{actionLabel(action)}</strong><small>{action.reason}</small></span></li>)}</ol><footer><span>Expires in 15 minutes</span><button onClick={() => { onClose(); onNeedsYou?.(); }}>Review exact plan in Needs You</button></footer></div> : answer ? <><div className="mission-ai-answer-copy"><span className="section-kicker">GROUNDED INTERPRETATION · VERIFY EVIDENCE</span><p>{answer.text}</p>{answer.estimate && <section className="mission-ai-estimate"><header><span>AI TIME RANGE</span><strong>{answer.estimate.minimumHours}–{answer.estimate.maximumHours} hours</strong><small>{answer.estimate.confidence} confidence</small></header><div><span><b>Assumptions</b>{answer.estimate.assumptions?.length ? answer.estimate.assumptions.join(" · ") : "None declared"}</span><span><b>Missing evidence</b>{answer.estimate.missingEvidence?.length ? answer.estimate.missingEvidence.join(" · ") : "None declared"}</span></div></section>}<div className="mission-ai-citations"><span>EVIDENCE USED</span>{(answer.citations || []).map(id => <button type="button" key={id} onClick={onEvidence}>{id}</button>)}</div></div><footer><span>{modelLabel(answer.model)} · {answer.authority} authority</span><span>{answer.context?.workerCount || 0} workers · {answer.context?.evidenceCount || 0} evidence references</span></footer></> : error ? <div className="mission-ai-answer-error"><strong>Mission AI could not complete the request</strong><p>{error}</p></div> : <div className="mission-ai-answer-empty"><strong>{mode === "ask" ? "One question. One current supervision snapshot." : "Plan freely. Execute only after review."}</strong><p>{mode === "ask" ? "Mission AI summarizes bounded evidence without inventing progress, percentages, or deadlines." : "Every action will be validated, shown in Needs You, executed through EngineAPI, and verified in History."}</p></div>}</div></>}
    <p id="mission-ai-boundary" className="mission-ai-boundary">Provider storage is disabled. Gemini proposes; local validation constrains; Needs You approves; EngineAPI executes and verifies.</p>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
