import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import { confirmedRequest, missionApi } from "./missionApi.js";
import { ModelMark, providerFamily } from "./aiCatalog.jsx";

/* Keys & models.

   Two kinds of model live here and they are kept visibly apart. Mission AI's
   are built into the app: the sheet reports whether its keys are present and
   which models they reach, and offers no way to see or change them. The
   operator's own keys are theirs: added by pasting, their model list read
   from the provider (no message is ever sent to test a model — that would
   spend from their account), stored with the operating system's credential
   protection, and removable. */

function ago(timestamp) {
  if (!timestamp) return "never";
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

function Dot({ on }) {
  return <i className={`ai-keys__dot ${on ? "is-on" : ""}`} aria-hidden="true"/>;
}

function ModelStrip({ models, defaultModel = null }) {
  if (!models?.length) return null;
  // The key's default model leads, marked. No model is tested, so the mark
  // says only which one chats start on.
  const ordered = [...models].sort((left, right) => Number(right.id === defaultModel) - Number(left.id === defaultModel));
  const shown = ordered.slice(0, 6);
  return <ul className="ai-keys__models" aria-label="Models this key can use">
    {shown.map(model => {
      const proven = model.id === defaultModel;
      return <li key={model.id} className={proven ? "is-proven" : ""} title={proven ? "This key's default model" : undefined}>
        <ModelMark family={model.family} size={12}/><span>{model.label}</span>
        {proven && <svg className="ai-keys__proven" width="11" height="11" viewBox="0 0 24 24" aria-label="Default"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </li>;
    })}
    {models.length > shown.length && <li className="is-more">+{models.length - shown.length} more</li>}
  </ul>;
}

// What the pasted key looks like, asked of the main process as it is typed.
// Only its shape is read; nothing is sent to a provider until Add key.
function useKeyDetection(apiKey) {
  const [candidates, setCandidates] = React.useState(null);
  React.useEffect(() => {
    const key = apiKey.trim();
    if (key.length < 8) { setCandidates(null); return undefined; }
    let active = true;
    const timer = window.setTimeout(() => {
      missionApi().request("ai.byok.detect", { apiKey: key })
        .then(value => { if (active) setCandidates(Array.isArray(value?.candidates) ? value.candidates : []); })
        .catch(() => { if (active) setCandidates(null); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [apiKey]);
  return candidates;
}

function listPhrase(labels) {
  if (labels.length <= 1) return labels[0] || "";
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

function AddKeyForm({ status, onAdded }) {
  const [apiKey, setApiKey] = React.useState("");
  const [provider, setProvider] = React.useState("auto");
  const [label, setLabel] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState("");
  const providers = status?.providers || [];
  const needsBaseUrl = provider === "custom";
  const candidates = useKeyDetection(apiKey);
  const auto = provider === "auto";
  const chosen = providers.find(item => item.id === provider);
  const unrecognised = auto && Array.isArray(candidates) && candidates.length === 0 && apiKey.trim().length >= 16;
  const checkingWith = auto ? (candidates?.length === 1 ? candidates[0].label : "") : chosen?.label || "";

  const submit = async event => {
    event.preventDefault();
    if (!apiKey.trim() || busy || unrecognised) return;
    setBusy(true);
    setProblem("");
    try {
      const result = await missionApi().request("ai.byok.add", { apiKey: apiKey.trim(), provider, label: label.trim(), baseUrl: needsBaseUrl ? baseUrl.trim() : "" });
      setApiKey("");
      setLabel("");
      setBaseUrl("");
      setProvider("auto");
      onAdded?.(result);
    } catch (value) {
      setProblem(value?.message || String(value));
    } finally {
      setBusy(false);
    }
  };

  return <form className="ai-keys__add" onSubmit={submit}>
    <label className="ai-keys__field">
      <span>API key</span>
      <input type="password" autoComplete="off" spellCheck="false" value={apiKey} onChange={event => { setApiKey(event.target.value); setProblem(""); }} placeholder="Paste a key — Gemini, OpenAI, Anthropic, NVIDIA, OpenRouter, Groq…" disabled={busy || !status?.keyProtection}/>
    </label>
    <p className="ai-keys__disclaimer">
      <strong>Note:</strong> Mission Control does not charge any fee. Discovering and listing models uses free metadata endpoints ($0.00). While adding or verifying some models on paid provider accounts, it may cost a very little amount (a few tokens) directly from your provider. Your key is encrypted on this device.
    </p>
    {auto && candidates && apiKey.trim() && <p className={`ai-keys__detect ${candidates.length ? "is-found" : "is-unknown"}`} role="status">
      {candidates.length === 1 && <><ModelMark family={providerFamily(candidates[0].id)} size={13}/><span><strong>{candidates[0].label}</strong> key</span></>}
      {candidates.length > 1 && <span>Could be <strong>{listPhrase(candidates.map(item => item.label))}</strong> — each is tried in turn until one accepts it.</span>}
      {!candidates.length && apiKey.trim().length >= 16 && <span>This key's format isn't one Mission Control knows. Choose its provider below — or OpenAI-compatible with a base URL.</span>}
    </p>}
    <div className="ai-keys__row">
      <div className="ai-keys__field">
        <span id="ai-keys-provider">Provider</span>
        <Select.Root value={provider} onValueChange={setProvider} disabled={busy}>
          <Select.Trigger className="ai-keys__select" aria-labelledby="ai-keys-provider">
            <Select.Value/>
            <Select.Icon className="ai-keys__select-icon">⌄</Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content className="ai-keys__select-menu" position="popper" sideOffset={4}>
              <Select.Viewport>
                <Select.Item value="auto" className="ai-keys__select-item"><Select.ItemText>Detect from the key</Select.ItemText></Select.Item>
                {providers.map(item => <Select.Item key={item.id} value={item.id} className="ai-keys__select-item">
                  <ModelMark family={providerFamily(item.id)} size={13}/>
                  <Select.ItemText>{item.label}</Select.ItemText>
                </Select.Item>)}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>
      <label className="ai-keys__field">
        <span>Name <em>optional</em></span>
        <input value={label} maxLength={60} onChange={event => setLabel(event.target.value)} placeholder={auto && candidates?.length === 1 ? candidates[0].label : chosen && provider !== "custom" ? chosen.label : "Work account"} disabled={busy}/>
      </label>
    </div>
    {needsBaseUrl && <label className="ai-keys__field">
      <span>Base URL</span>
      <input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" disabled={busy}/>
    </label>}
    {problem && <p className="ai-keys__problem" role="alert">{problem}</p>}
    <footer>
      <button type="submit" className="ai-keys__primary" disabled={busy || !apiKey.trim() || !status?.keyProtection || unrecognised}>{busy ? (checkingWith ? `Checking with ${checkingWith}…` : "Checking the key…") : "Add key"}</button>
      <p>{status?.keyProtection
        ? "Mission Control reads the list of models this key can use — no message is sent, so nothing is charged — then encrypts the key with this computer's credential protection. It is only ever sent to its provider."
        : "This computer's credential protection is unavailable, so keys cannot be stored safely here."}</p>
    </footer>
  </form>;
}

export default function AssistantKeys({ open, onOpenChange, status, onStatus, onConfirm }) {
  const [busyKey, setBusyKey] = React.useState("");
  const [problem, setProblem] = React.useState("");
  const [added, setAdded] = React.useState(null);
  const mission = status?.mission;
  React.useEffect(() => { if (!open) setAdded(null); }, [open]);

  const refresh = async keyId => {
    setBusyKey(keyId || "mission");
    setProblem("");
    try { onStatus?.(await missionApi().request("ai.byok.refresh", keyId ? { keyId } : {})); }
    catch (value) { setProblem(value?.message || String(value)); }
    finally { setBusyKey(""); }
  };

  const remove = key => onConfirm?.({
    title: `Remove ${key.label}?`,
    detail: "Its models disappear from every model switcher, and chats using it switch to another model.",
    recovery: "Paste the key again to add it back.",
    confirmLabel: "Remove key",
    run: async () => {
      try { const result = await confirmedRequest("ai.byok.remove", { keyId: key.id }); onStatus?.(result.status); }
      catch (value) { setProblem(value?.message || String(value)); }
    }
  });

  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="ai-keys-overlay"/>
      <Dialog.Content className="ai-keys" aria-describedby={undefined}>
        <header className="ai-keys__head">
          <Dialog.Title className="ai-keys__title">Keys &amp; models</Dialog.Title>
          <Dialog.Close className="ai-keys__close" aria-label="Close">×</Dialog.Close>
        </header>

        <div className="ai-keys__body">
          <section className="ai-keys__section">
            <h3 className="ai-keys__kicker">Mission AI</h3>
            <article className="ai-keys__card is-builtin">
              <div className="ai-keys__card-head">
                <ModelMark family="gemini" size={22}/>
                <div>
                  <strong>Built-in Gemini</strong>
                  <span>{mission?.available
                    ? `${mission.models?.length || 0} free-tier models · checked ${ago(mission.modelsCheckedAt)}`
                    : "Not set up in this build"}</span>
                </div>
                {mission?.available && <button type="button" className="ai-keys__ghost" disabled={busyKey === "mission"} onClick={() => void refresh(null)}>{busyKey === "mission" ? "Checking…" : "Refresh"}</button>}
              </div>
              <div className="ai-keys__slots">
                <span><Dot on={mission?.keys?.primary}/>Primary key {mission?.keys?.primary ? "ready" : "missing"}</span>
                <span><Dot on={mission?.keys?.fallback}/>Fallback key {mission?.keys?.fallback ? "ready" : "missing"}</span>
              </div>
              {mission?.modelsError && <p className="ai-keys__problem">{mission.modelsError}</p>}
              <ModelStrip models={mission?.models}/>
              <p className="ai-keys__note">These keys are part of the app. They cannot be viewed or changed here — when the first runs out, the second takes over, and if both are at their limit Mission AI answers with the lighter Flash-Lite model. Only fast, free-tier Flash models are offered, so everyday questions don't use up the limits.</p>
            </article>
          </section>

          <section className="ai-keys__section">
            <h3 className="ai-keys__kicker">Your keys</h3>
            {status?.keysError && <p className="ai-keys__problem">{status.keysError}</p>}
            {added && <p className="ai-keys__added" role="status">
              <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span><strong>{added.detected?.label || added.key?.label} key added</strong> — {added.key?.models?.length || 0} models found. Choose any of them from the model menu.</span>
            </p>}
            {!status?.keys?.length && <p className="ai-keys__empty">No keys yet. Add one below to use its models in Mission AI and the Workspace chat.</p>}
            {(status?.keys || []).map(key => <article key={key.id} className="ai-keys__card">
              <div className="ai-keys__card-head">
                <ModelMark family={providerFamily(key.provider)} size={22}/>
                <div>
                  <strong>{key.label}</strong>
                  <span>{key.hint ? `····${key.hint} · ` : ""}{key.models.length} models · checked {ago(key.modelsCheckedAt)}</span>
                </div>
                <button type="button" className="ai-keys__ghost" disabled={busyKey === key.id} onClick={() => void refresh(key.id)}>{busyKey === key.id ? "Checking…" : "Refresh"}</button>
                <button type="button" className="ai-keys__ghost is-danger" onClick={() => remove(key)}>Remove</button>
              </div>
              {key.lastError && <p className="ai-keys__problem">{key.lastError}</p>}
              <ModelStrip models={key.models} defaultModel={key.defaultModel}/>
            </article>)}
            {problem && <p className="ai-keys__problem" role="alert">{problem}</p>}
          </section>

          <section className="ai-keys__section">
            <h3 className="ai-keys__kicker">Add a key</h3>
            <AddKeyForm status={status} onAdded={result => { setAdded(result); onStatus?.(result.status); }}/>
          </section>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
