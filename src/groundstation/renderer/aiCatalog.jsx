import React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { missionApi } from "./missionApi.js";

/* Shared pieces of the assistant UI: the mark that identifies which model
   family is answering, the model switcher, and the two hooks every chat
   surface reads its state through. Mission AI and the Workspace pane both use
   these, so a model looks the same and switches the same way wherever it is. */

// Original marks drawn to be recognisable by colour and silhouette at 14-20px.
// They identify which provider a model belongs to; they are not the providers'
// logos. Colours live here rather than in a stylesheet because they are part of
// the identity of each mark, not of the app's palette.
function MarkPaths({ family, gradientId }) {
  switch (family) {
    case "gemini":
      return <>
        <defs>
          <linearGradient id={gradientId} x1="3" y1="21" x2="21" y2="3" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#1a73e8"/>
            <stop offset="0.55" stopColor="#6c63ff"/>
            <stop offset="1" stopColor="#c86dd7"/>
          </linearGradient>
        </defs>
        <path d="M12 2c.5 5.3 4.7 9.5 10 10-5.3.5-9.5 4.7-10 10-.5-5.3-4.7-9.5-10-10 5.3-.5 9.5-4.7 10-10Z" fill={`url(#${gradientId})`}/>
      </>;
    case "gemma":
      return <path d="M12 3.5c.4 4.3 3.9 7.8 8.2 8.2-4.3.4-7.8 3.9-8.2 8.2-.4-4.3-3.9-7.8-8.2-8.2 4.3-.4 7.8-3.9 8.2-8.2Z" fill="none" stroke="#3ec5b3" strokeWidth="1.9" strokeLinejoin="round"/>;
    case "claude":
      return <g stroke="#d97757" strokeWidth="2.3" strokeLinecap="round">
        {[0, 45, 90, 135].map(angle => <path key={angle} d="M12 4.2v15.6" transform={`rotate(${angle} 12 12)`}/>)}
      </g>;
    case "gpt":
      return <g fill="none" stroke="#ececec" strokeWidth="1.6">
        {[0, 60, 120].map(angle => <ellipse key={angle} cx="12" cy="12" rx="8.6" ry="3.7" transform={`rotate(${angle} 12 12)`}/>)}
      </g>;
    case "llama":
      return <path d="M4.5 15.5c0-3.4 1.8-7 3.9-7 2.5 0 3.6 7 7.1 7 1.8 0 3-1.6 3-3.5s-1.2-3.5-3-3.5c-3.5 0-4.6 7-7.1 7-2.1 0-3.9-1.6-3.9-3.5" fill="none" stroke="#1d7bff" strokeWidth="2" strokeLinecap="round"/>;
    case "mistral":
      return <g>
        <rect x="4" y="5" width="4" height="4" fill="#ffd400"/><rect x="16" y="5" width="4" height="4" fill="#ffd400"/>
        <rect x="4" y="9.5" width="16" height="3.5" fill="#ff9a00"/>
        <rect x="4" y="13.5" width="4" height="4" fill="#ff6a00"/><rect x="10" y="13.5" width="4" height="4" fill="#ff6a00"/><rect x="16" y="13.5" width="4" height="4" fill="#ff6a00"/>
        <rect x="2" y="18" width="8" height="2.5" fill="#e62e05"/><rect x="14" y="18" width="8" height="2.5" fill="#e62e05"/>
      </g>;
    case "deepseek":
      return <g>
        <path d="M3.5 12.5c0-4.1 3.6-7 8.2-7 3.6 0 6.2 1.7 7.4 4.2l2.4-.9-.9 3.3c.1.4.1.9.1 1.3 0 3.9-3.8 6.1-8.6 6.1-4.6 0-8.6-2.8-8.6-7Z" fill="#4d6bfe"/>
        <circle cx="15.2" cy="10.6" r="1.1" fill="#ffffff"/>
      </g>;
    case "grok":
      return <g fill="none" stroke="#f2f2f2" strokeWidth="2" strokeLinecap="round"><path d="M6 19 18.5 4.5"/><path d="M9.5 6.5A6.5 6.5 0 0 1 18 14"/></g>;
    case "qwen":
      return <path d="M12 3.2 19.6 7.6v8.8L12 20.8 4.4 16.4V7.6Z" fill="none" stroke="#7a6cff" strokeWidth="2" strokeLinejoin="round"/>;
    case "kimi":
      return <g><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" fill="#1c1c1c" stroke="#5b5b5b"/><path d="M9 7.5v9M9 12l5.5-4.5M10.5 11l4.5 5.5" stroke="#f5f5f5" strokeWidth="1.8" strokeLinecap="round"/></g>;
    case "openrouter":
      return <g fill="none" stroke="#7c83ff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h5.5c2.2 0 3-4.5 5.5-4.5H20"/><path d="M9.5 12c2.2 0 3 4.5 5.5 4.5H20"/><path d="m17.5 5 2.5 2.5-2.5 2.5M17.5 14l2.5 2.5-2.5 2.5"/></g>;
    case "groq":
      return <g fill="none" stroke="#f55036" strokeWidth="2.2" strokeLinecap="round"><path d="M17.5 8.2A6.5 6.5 0 1 0 18.5 12h-6"/></g>;
    case "nvidia":
      return <g>
        <path d="M9.2 7.2c4.5-.6 8.6 1.6 11.3 4.8-2.7 3.2-6.8 5.4-11.3 4.8Z" fill="#76b900"/>
        <path d="M9.2 9.6c2.4-.2 4.6.9 6.1 2.4-1.5 1.5-3.7 2.6-6.1 2.4Z" fill="#101010"/>
        <path d="M3.5 12c1.3-2.2 3.3-3.9 5.7-4.8v9.6c-2.4-.9-4.4-2.6-5.7-4.8Z" fill="#76b900"/>
      </g>;
    case "perplexity":
      return <g fill="none" stroke="#20b8cd" strokeWidth="1.9" strokeLinejoin="round"><path d="M12 3v18M5 7.5l7 4.5 7-4.5M5 7.5v8l7-4.5M19 7.5v8l-7-4.5"/></g>;
    case "cerebras":
      return <g fill="none" stroke="#f15a29" strokeWidth="2" strokeLinecap="round"><path d="M16.5 6.3A7.5 7.5 0 1 0 16.5 17.7"/><path d="M14.2 9.2a3.8 3.8 0 1 0 0 5.6"/></g>;
    case "fireworks":
      return <path d="M12 3.5c1.6 3 4.6 4.6 4.6 8.4a4.6 4.6 0 0 1-9.2 0c0-2 1-3.3 2.1-4.5.2 1.4.9 2.2 1.8 2.6-.4-2.4.1-4.6.7-6.5Z" fill="#6d28d9"/>;
    case "huggingface":
      return <g><circle cx="12" cy="12" r="8.5" fill="#ffd21e"/><circle cx="9" cy="10.5" r="1.1" fill="#3a3b45"/><circle cx="15" cy="10.5" r="1.1" fill="#3a3b45"/><path d="M8.5 14c1 1.4 2.1 2 3.5 2s2.5-.6 3.5-2" fill="none" stroke="#3a3b45" strokeWidth="1.5" strokeLinecap="round"/></g>;
    default:
      return <g fill="none" stroke="#9a9a9a" strokeWidth="1.8"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.2" fill="#9a9a9a" stroke="none"/></g>;
  }
}

const PROVIDER_FAMILY = {
  gemini: "gemini", openai: "gpt", anthropic: "claude", openrouter: "openrouter", groq: "groq",
  xai: "grok", deepseek: "deepseek", mistral: "mistral", together: "other", custom: "other",
  nvidia: "nvidia", perplexity: "perplexity", cerebras: "cerebras", fireworks: "fireworks",
  huggingface: "huggingface", moonshot: "kimi", qwen: "qwen", sambanova: "other", deepinfra: "other"
};

export function providerFamily(provider) {
  return PROVIDER_FAMILY[provider] || "other";
}

export function ModelMark({ family = "other", size = 16, title }) {
  const gradientId = `mark-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return <svg className={`ai-mark ai-mark--${family}`} width={size} height={size} viewBox="0 0 24 24" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : "true"} focusable="false"><MarkPaths family={family} gradientId={gradientId}/></svg>;
}

const TIER_LABEL = { fast: "Fast", balanced: "Balanced", capable: "Most capable" };

export function tierLabel(tier) {
  return TIER_LABEL[tier] || "";
}

// ------------------------------------------------------------------ hooks

export function useAssistantStatus() {
  const [status, setStatus] = React.useState(null);
  const [error, setError] = React.useState("");
  const refresh = React.useCallback(async () => {
    try {
      setStatus(await missionApi().request("ai.status"));
      setError("");
    } catch (value) {
      setError(value?.message || String(value));
    }
  }, []);
  React.useEffect(() => {
    let active = true;
    void refresh();
    let unsubscribe = () => {};
    try {
      unsubscribe = missionApi().subscribe(message => {
        if (active && message?.type === "ai:changed") void refresh();
      });
    } catch { /* manual refresh still works */ }
    return () => { active = false; unsubscribe?.(); };
  }, [refresh]);
  return { status, error, refresh, setStatus };
}

const EMPTY_CONVERSATION = { messages: [], pending: null, busy: false, autoApprove: false };

export function useConversation(conversationId, surface) {
  const [conversation, setConversation] = React.useState(EMPTY_CONVERSATION);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let active = true;
    setConversation(EMPTY_CONVERSATION);
    missionApi().request("ai.chat.history", { conversationId })
      .then(value => { if (active && value) setConversation({ ...EMPTY_CONVERSATION, ...value }); })
      .catch(() => {});
    let unsubscribe = () => {};
    try {
      // Each step of a turn is published as it happens — a tool starting, an
      // approval appearing, the reply landing — so progress shows while the
      // request that started it is still open.
      unsubscribe = missionApi().subscribe(message => {
        if (!active || message?.type !== "ai:conversation" || message.conversationId !== conversationId) return;
        setConversation({ ...EMPTY_CONVERSATION, ...message.conversation });
      });
    } catch { /* the request result still lands */ }
    return () => { active = false; unsubscribe?.(); };
  }, [conversationId]);

  const run = React.useCallback(async (method, params) => {
    setError("");
    try {
      const value = await missionApi().request(method, { conversationId, ...params });
      if (value && Array.isArray(value.messages)) setConversation({ ...EMPTY_CONVERSATION, ...value });
      return value;
    } catch (value) {
      setError(value?.message || String(value));
      return null;
    }
  }, [conversationId]);

  return {
    ...conversation,
    error,
    clearError: () => setError(""),
    send: (text, focusWorkerId = null) => run("ai.chat.send", { surface, text, focusWorkerId }),
    resolve: decision => run("ai.chat.resolve", { decision }),
    clear: () => run("ai.chat.clear", {}),
    cancel: () => run("ai.chat.cancel", {}),
    setAutoApprove: enabled => run("ai.chat.autoApprove", { enabled })
  };
}

// ------------------------------------------------------------------ switcher

function modelGroups(status) {
  const groups = [];
  if (status?.mission?.available) {
    groups.push({ id: "mission", heading: "Mission AI", detail: "Built in", source: "mission", keyId: null, provider: "gemini", models: status.mission.models || [] });
  }
  for (const key of status?.keys || []) {
    groups.push({ id: key.id, heading: key.label, detail: key.hint ? `····${key.hint}` : "Your key", source: "byok", keyId: key.id, provider: key.provider, models: key.models || [] });
  }
  return groups;
}

/* The model switcher. A popover rather than a menu because a key can reach a
   hundred models, and a hundred models need a search field — which a Radix
   menu cannot hold. cmdk supplies the filtering and the keyboard model. */
export function ModelSwitcher({ status, surface, compact = false, disabled = false, align = null, onManageKeys, onChanged }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [collapsed, setCollapsed] = React.useState({});
  const selection = status?.selections?.[surface] || null;
  const groups = modelGroups(status);
  const total = groups.reduce((sum, group) => sum + group.models.length, 0);

  const builtinGroups = groups.filter(g => g.source === "mission");
  const byokGroups = groups.filter(g => g.source === "byok");
  const isSearching = Boolean(search.trim());

  const toggleGroup = (groupId, e) => {
    e?.stopPropagation?.();
    e?.preventDefault?.();
    setCollapsed(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const choose = async (group, model) => {
    setBusy(true);
    setProblem("");
    try {
      const next = await missionApi().request("ai.selection.set", { surface, target: { source: group.source, keyId: group.keyId, model: model.id } });
      onChanged?.(next);
      setOpen(false);
    } catch (value) {
      setProblem(value?.message || String(value));
    } finally {
      setBusy(false);
    }
  };

  const renderKeyGroup = (group, isBuiltin = false) => {
    const isCollapsed = !isSearching && Boolean(collapsed[group.id]);
    const isCurrentGroup = selection && selection.source === group.source && (selection.keyId || null) === (group.keyId || null);

    return (
      <div className={`ai-model-menu__section ${isBuiltin ? "ai-model-menu__section--builtin" : "ai-model-menu__section--byok-key"}`} key={group.id}>
        <div
          className={`ai-model-menu__key-banner ${isBuiltin ? "ai-model-menu__key-banner--builtin" : ""}`}
          onClick={e => toggleGroup(group.id, e)}
          role="button"
          tabIndex={0}
          aria-expanded={!isCollapsed}
          onKeyDown={e => {
            if (e.key === "Enter" || e.key === " ") toggleGroup(group.id, e);
          }}
        >
          <div className="ai-model-menu__key-banner-left">
            <ModelMark family={providerFamily(group.provider)} size={14}/>
            <span className="ai-model-menu__key-title">{group.heading}</span>
            {isBuiltin ? (
              <span className="ai-model-menu__section-badge is-free">Free</span>
            ) : group.detail ? (
              <span className="ai-model-menu__key-hint">{group.detail}</span>
            ) : null}
          </div>
          <div className="ai-model-menu__key-banner-right">
            <span className="ai-model-menu__count-badge">{group.models.length}</span>
            <svg
              className={`ai-model-menu__group-chevron ${isCollapsed ? "is-collapsed" : ""}`}
              width="11"
              height="11"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>

        <Command.Group key={group.id}>
          {!isCollapsed && (
            <div className="ai-model-menu__group-items">
              {group.models.length === 0 && <div className="ai-model-menu__empty">No chat models found for this key.</div>}
              {group.models.map(model => {
                const current = isCurrentGroup && selection.model === model.id;
                return (
                  <Command.Item
                    key={`${group.id}:${model.id}`}
                    value={`${group.heading} ${model.label} ${model.id}`}
                    disabled={busy}
                    onSelect={() => void choose(group, model)}
                    className={`ai-model-option ${current ? "is-current" : ""}`}
                  >
                    <ModelMark family={model.family} size={15}/>
                    <span className="ai-model-option__name">{model.label}</span>
                    {model.tier && <span className={`ai-model-option__tier tier-${model.tier}`}>{tierLabel(model.tier)}</span>}
                    <svg className="ai-model-option__check" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </Command.Item>
                );
              })}
            </div>
          )}
        </Command.Group>
      </div>
    );
  };

  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <button type="button" className={`ai-switcher ${compact ? "is-compact" : ""}`} disabled={disabled || !groups.length} aria-label={selection ? `Model: ${selection.label}. Change model` : "Choose a model"} onMouseDown={event => event.stopPropagation()}>
        <ModelMark family={selection?.family || "other"} size={compact ? 13 : 15}/>
        <span className="ai-switcher__label">{selection ? selection.label : "No model"}</span>
        {!compact && selection && <span className="ai-switcher__source">{selection.source === "mission" ? "Mission AI" : selection.keyLabel}</span>}
        <svg className="ai-switcher__chevron" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="ai-model-menu" align={align || (compact ? "start" : "end")} sideOffset={6} collisionPadding={12} onOpenAutoFocus={event => { event.preventDefault(); const menu = event.currentTarget; (menu.querySelector("[cmdk-input]") || menu.querySelector("[cmdk-root]"))?.focus(); }}>
        <Command label="Choose a model" loop>
          {total > 6 && (
            <div className="ai-model-menu__search">
              <Command.Input
                placeholder={`Search ${total} models...`}
                value={search}
                onValueChange={setSearch}
              />
            </div>
          )}
          <Command.List className="ai-model-menu__list">
            <Command.Empty className="ai-model-menu__empty">No model matches that.</Command.Empty>
            
            {builtinGroups.length > 0 && (
              <div className="ai-model-menu__category ai-model-menu__category--builtin">
                <div className="ai-model-menu__category-header">
                  <span className="ai-model-menu__category-title">Built-in AI Models</span>
                  <span className="ai-model-menu__section-badge is-free">Free Tier</span>
                </div>
                {builtinGroups.map(group => renderKeyGroup(group, true))}
              </div>
            )}

            <div className="ai-model-menu__category ai-model-menu__category--byok">
              <div className="ai-model-menu__category-header">
                <span className="ai-model-menu__category-title">Your API Keys (BYOK)</span>
                {byokGroups.length > 0 ? (
                  <span className="ai-model-menu__section-badge">{byokGroups.length} {byokGroups.length === 1 ? "Key" : "Keys"}</span>
                ) : (
                  <span className="ai-model-menu__section-badge is-muted">None</span>
                )}
              </div>

              {byokGroups.length > 0 ? (
                <div className="ai-model-menu__byok-list">
                  {byokGroups.map(group => renderKeyGroup(group, false))}
                </div>
              ) : (
                <div className="ai-model-menu__byok-empty">
                  <p>No custom provider keys configured.</p>
                  {onManageKeys && (
                    <button
                      type="button"
                      className="ai-model-menu__byok-add-btn"
                      onClick={() => { setOpen(false); onManageKeys(); }}
                    >
                      + Add OpenAI, Anthropic, or Gemini Key
                    </button>
                  )}
                </div>
              )}
            </div>
          </Command.List>
        </Command>
        {problem && <p className="ai-model-menu__problem" role="alert">{problem}</p>}
        {onManageKeys && <button type="button" className="ai-model-menu__manage" onClick={() => { setOpen(false); onManageKeys(); }}>
          <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l2 2M14.5 8.5l2 2"/></g></svg>
          <span>Keys &amp; models</span>
        </button>}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
