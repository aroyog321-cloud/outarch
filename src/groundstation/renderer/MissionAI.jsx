import React from "react";
import { ModelMark, useAssistantStatus } from "./aiCatalog.jsx";
import AssistantKeys from "./AssistantKeys.jsx";

/* Mission AI, as it appears in Integrations.

   There is nothing to configure here any more, and that is the point. Mission
   AI answers with keys built into the app, so this section reports whether they
   are present and what they reach; the operator's own keys are managed in the
   Keys & models sheet, which this section opens. It used to be a form for
   pasting a Gemini key — the one thing operators are no longer asked to do. */

/* The states that decide whether Mission AI can answer, each named separately
   so a failure in one is never reported as a failure in another: keys missing
   is not a model listing that failed, and neither is "we don't know", which is
   what a failed status read means. Nothing here is derived from a key; the
   status only ever says whether one is present. */
function missionAiStates(status, error) {
  if (!status) {
    return [
      { key: "keys", label: "Built-in keys", value: error ? "Unknown - status could not be read" : "Checking…", tone: error ? "blocked" : "idle" },
      { key: "models", label: "Models", value: "Unknown", tone: "idle" },
      { key: "own", label: "Your keys", value: "Unknown", tone: "idle" },
      { key: "access", label: "Access", value: "Reads terminals · acts with your approval", tone: "idle" }
    ];
  }
  const mission = status.mission || {};
  const keys = mission.keys || {};
  return [
    {
      key: "keys",
      label: "Built-in keys",
      value: mission.available
        ? `Primary ${keys.primary ? "ready" : "missing"} · fallback ${keys.fallback ? "ready" : "missing"}`
        : "Not set in this build",
      tone: mission.available ? (keys.primary && keys.fallback ? "ready" : "waiting") : "idle"
    },
    {
      key: "models",
      label: "Models",
      value: mission.modelsError
        ? `Failed - ${mission.modelsError}`
        : mission.available ? `${mission.models?.length || 0} Gemini models` : "None",
      tone: mission.modelsError ? "blocked" : mission.available ? "ready" : "idle"
    },
    {
      key: "own",
      label: "Your keys",
      value: status.keys?.length ? `${status.keys.length} saved · ${status.keys.reduce((sum, key) => sum + key.models.length, 0)} models` : "None added",
      tone: status.keys?.length ? "ready" : "idle"
    },
    {
      key: "access",
      label: "Access",
      value: "Reads terminals · acts with your approval",
      tone: "ready"
    }
  ];
}

function MissionAIStateFacts({ status, error }) {
  return <dl className="ai-integration__facts" aria-label="Mission AI state">
    {missionAiStates(status, error).map(item => <div key={item.key} className={`tone-${item.tone}`}>
      <dt>{item.label}</dt>
      <dd>{item.value}</dd>
    </div>)}
  </dl>;
}

export function MissionAISettings({ onOpen, onConfirm }) {
  const { status, error, refresh, setStatus } = useAssistantStatus();
  const [keysOpen, setKeysOpen] = React.useState(false);
  const selection = status?.selections?.missionAi || null;
  const ready = Boolean(selection);

  return <section className="ai-integration">
    <header className="ai-integration__head">
      <span className="ai-integration__mark"><ModelMark family="gemini" size={26}/></span>
      <div>
        <h3>Mission AI</h3>
        <p>Answers questions about the project from what its terminals printed, and starts, stops, restarts and types into them when you approve.</p>
      </div>
      <span className={`ai-integration__state ${ready ? "is-ready" : "is-idle"}`}><i aria-hidden="true"/>{!status ? (error ? "Status unavailable" : "Checking…") : ready ? "Ready" : "Needs a model"}</span>
    </header>

    {error && <div className="integration-resource-notice" role="status"><span><strong>Mission AI status could not be read.</strong> {error}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}

    <MissionAIStateFacts status={status} error={error}/>

    {selection && <div className="ai-integration__current">
      <span>Answering with</span>
      <ModelMark family={selection.family} size={14}/>
      <strong>{selection.label}</strong>
      <em>{selection.source === "mission" ? "Mission AI" : selection.keyLabel}</em>
    </div>}

    <footer className="ai-integration__foot">
      <p>Keys are never shown or sent anywhere except the provider they belong to. Mission AI's own keys cannot be changed from the app.</p>
      <div>
        <button type="button" className="ai-integration__secondary" onClick={() => setKeysOpen(true)}>Keys &amp; models</button>
        <button type="button" className="ai-integration__primary" onClick={onOpen}>Open Mission AI</button>
      </div>
    </footer>

    <AssistantKeys open={keysOpen} onOpenChange={value => { setKeysOpen(value); if (!value) void refresh(); }} status={status} onStatus={next => next && setStatus(next)} onConfirm={onConfirm}/>
  </section>;
}
