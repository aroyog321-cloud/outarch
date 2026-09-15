import React from "react";
import { ModelMark, ModelSwitcher, useAssistantStatus, useConversation } from "./aiCatalog.jsx";
import { AssistantComposer, AssistantThread } from "./AssistantChat.jsx";
import AssistantKeys from "./AssistantKeys.jsx";

export { parseMarkdownBlocks, renderMarkdown, StreamingReveal } from "./aiMarkdown.jsx";

/* Mission AI.

   A conversation with the project. It answers from what the terminals actually
   printed — it reads them itself rather than guessing — and when the answer is
   an action it proposes the action, with the exact command, for the operator
   to run with one click. It can answer with Mission AI's own models or with a
   model from a key the operator brought, and switching is one control.

   What it replaced answered in a forced JSON envelope with a trail of evidence
   IDs under every reply, routed ordinary questions to an action planner, and —
   because the chat layer read a field the service never returned — showed an
   empty reply for every real question. */

export const MISSION_AI_CONVERSATION = "mission-ai";

const SUGGESTIONS = [
  "What's running right now, and is anything unhealthy?",
  "Why did my last failed worker stop?",
  "Which local servers are up, and on which ports?",
  "Start everything that's idle"
];

function Welcome({ status, onSuggest, onManageKeys }) {
  const hasModel = Boolean(status?.selections?.missionAi);
  if (status && !hasModel) {
    return <section className="ai-welcome is-setup">
      <span className="ai-welcome__mark"><ModelMark family="gemini" size={30}/></span>
      <h2 className="ai-welcome__title">Mission AI needs a model</h2>
      <p>This build has no built-in Mission AI keys yet. Add a key of your own — Gemini, OpenAI, Anthropic, NVIDIA, OpenRouter, Groq and other OpenAI-compatible providers all work. Mission Control recognises the key, finds its models and checks one answers.</p>
      <button type="button" className="ai-welcome__primary" onClick={onManageKeys}>Add a key</button>
    </section>;
  }
  return <section className="ai-welcome">
    <span className="ai-welcome__mark"><ModelMark family={status?.selections?.missionAi?.family || "gemini"} size={30}/></span>
    <h2 className="ai-welcome__title">What should we look at?</h2>
    <p>Ask about any worker, error or port. Mission AI reads the terminals itself, and anything that would change your project is shown to you before it runs.</p>
    <div className="ai-welcome__suggestions">
      {SUGGESTIONS.map(text => <button key={text} type="button" onClick={() => onSuggest(text)}>{text}</button>)}
    </div>
  </section>;
}

export default function MissionAIScreen({ initialPrompt = "", onConfirm }) {
  const { status, refresh, setStatus } = useAssistantStatus();
  const conversation = useConversation(MISSION_AI_CONVERSATION, "missionAi");
  const [keysOpen, setKeysOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(initialPrompt || "");
  const inputRef = React.useRef(null);
  const hasModel = Boolean(status?.selections?.missionAi);

  // A prompt handed over from elsewhere in the app ("Ask Mission AI" on a
  // crashed worker, a recipe idea) lands in the composer for the operator to
  // read and send, rather than being sent on their behalf.
  React.useEffect(() => {
    if (!initialPrompt) return;
    setDraft(initialPrompt.slice(0, 8000));
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [initialPrompt]);

  const lastUserText = [...conversation.messages].reverse().find(item => item.role === "user")?.text || "";

  return <div className="ai-screen">
    <header className="ai-screen__head">
      <div className="ai-screen__title">
        <span className="ai-screen__mark"><ModelMark family="gemini" size={20}/></span>
        <div>
          <h1>Mission AI</h1>
          <span className="ai-screen__subtitle">Reads your terminals and acts when you say so.</span>
        </div>
      </div>
      <div className="ai-screen__actions">
        <button type="button" className="ai-screen__button" onClick={() => setKeysOpen(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l2 2M14.5 8.5l2 2"/></g></svg>
          Keys &amp; models
        </button>
        <button type="button" className="ai-screen__button" disabled={!conversation.messages.length || conversation.busy} onClick={() => void conversation.clear()}>
          <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
          New chat
        </button>
      </div>
    </header>

    <div className="ai-screen__body">
      <AssistantThread
        conversation={conversation}
        emptyState={<Welcome status={status} onManageKeys={() => setKeysOpen(true)} onSuggest={text => void conversation.send(text)}/>}
        onRetry={lastUserText ? () => void conversation.send(lastUserText) : undefined}
      />
      <AssistantComposer
        conversation={conversation}
        disabled={!hasModel}
        disabledReason={status && !hasModel ? "Add a key to start" : ""}
        placeholder="Ask about your project, or tell Mission AI what to do"
        draft={draft}
        onDraft={setDraft}
        inputRef={inputRef}
        toolbar={<>
          <ModelSwitcher status={status} surface="missionAi" disabled={conversation.busy} align="start" onManageKeys={() => setKeysOpen(true)} onChanged={setStatus}/>
          <button
            type="button"
            role="switch"
            aria-checked={conversation.autoApprove}
            className={`ai-screen__toggle ${conversation.autoApprove ? "is-on" : ""}`}
            onClick={() => void conversation.setAutoApprove(!conversation.autoApprove)}
            title={conversation.autoApprove ? "Mission AI runs actions in this chat without asking. Click to ask first again." : "Mission AI asks before it changes anything. Click to let it act without asking in this chat."}
          >
            <i aria-hidden="true"/>
            <span>Act without asking</span>
          </button>
        </>}
      />
    </div>

    <AssistantKeys open={keysOpen} onOpenChange={value => { setKeysOpen(value); if (!value) void refresh(); }} status={status} onStatus={next => next && setStatus(next)} onConfirm={onConfirm}/>
  </div>;
}
