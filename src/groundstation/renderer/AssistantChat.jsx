import React from "react";
import { requestUpgrade } from "./useAccount.js";
import { CrownIcon } from "./PlanLock.jsx";
import { ModelMark } from "./aiCatalog.jsx";
import { renderMarkdown } from "./aiMarkdown.jsx";

/* The conversation itself: messages, what the assistant did while answering,
   the approval card for anything it wants to change, and the composer.

   Mission AI renders it as a page and the Workspace renders it as a pane, so
   the two differ in density and in nothing else — the same approval, the same
   activity trail, the same keyboard. */

function ActivityIcon({ state }) {
  if (state === "running") return <span className="ai-activity__spinner" aria-hidden="true"/>;
  const paths = {
    done: <path d="m5 12.5 4.5 4.5L19 7.5"/>,
    failed: <><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/></>,
    waiting: <><circle cx="12" cy="12" r="7.5"/><path d="M12 8v4.2l2.6 1.6"/></>,
    declined: <path d="M7 7l10 10M17 7 7 17"/>
  };
  return <svg className="ai-activity__icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">{paths[state] || paths.done}</g></svg>;
}

const STATE_WORDS = { running: "in progress", done: "done", failed: "failed", waiting: "waiting for approval", declined: "not run" };

/* A command the assistant ran in its own terminal. That terminal never
   appears in the workspace, so this is where its output is read: live while
   the command runs, left open when it fails, folded away when it succeeds. */
function CommandOutput({ item }) {
  const running = item.state === "running";
  const outputRef = React.useRef(null);
  const stickRef = React.useRef(true);

  React.useLayoutEffect(() => {
    const node = outputRef.current;
    if (node && stickRef.current) node.scrollTop = node.scrollHeight;
  }, [item.output]);

  const status = running ? "Running" : Number.isInteger(item.exitCode) ? `Exit ${item.exitCode}` : item.state === "failed" ? "Not finished" : "Done";
  return <details className={`ai-run is-${item.state}`} open={running || item.state === "failed"}>
    <summary>
      <svg className="ai-run__chevron" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
      <span>Output</span>
      <span className="ai-run__status">{status}</span>
    </summary>
    <pre
      ref={outputRef}
      className="ai-run__output"
      tabIndex={0}
      role="group"
      aria-label="Command output"
      onScroll={event => { const node = event.currentTarget; stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24; }}
    ><span className="ai-run__prompt">$ {item.command}</span>{"\n"}{item.output || (running ? "" : "No output")}</pre>
  </details>;
}

function Activity({ items }) {
  if (!items?.length) return null;
  return <ul className="ai-activity" aria-label="What the assistant did">
    {items.map(item => <li key={item.id} className={`ai-activity__item is-${item.state}`}>
      <ActivityIcon state={item.state}/>
      <span className="ai-activity__label">{item.label}</span>
      <span className="sr-only">, {STATE_WORDS[item.state] || item.state}</span>
      {item.state === "failed" && item.detail && <span className="ai-activity__detail">{item.detail}</span>}
      {item.command && ["running", "done", "failed"].includes(item.state) && <CommandOutput item={item}/>}
    </li>)}
  </ul>;
}

function ApprovalCard({ pending, busy, compact, onResolve }) {
  const count = pending.actions.length;
  return <section className={`ai-approval ${compact ? "is-compact" : ""}`} aria-label="Approve what the assistant wants to do">
    <header>
      <span className="ai-approval__badge">Needs your OK</span>
      <span>{count === 1 ? "This will run as soon as you allow it." : `These ${count} actions run in order once you allow them.`}</span>
    </header>
    <ol>
      {pending.actions.map(action => <li key={action.id} className={`risk-${action.risk}`}>
        <strong>{action.title}</strong>
        {action.detail && (action.code ? <code>{action.detail}</code> : <span>{action.detail}</span>)}
      </li>)}
    </ol>
    <footer>
      <button type="button" className="ai-approval__run" disabled={busy} onClick={() => onResolve("approve")}>{count === 1 ? "Run it" : "Run all"}</button>
      <button type="button" className="ai-approval__deny" disabled={busy} onClick={() => onResolve("deny")}>Don't run</button>
      <button type="button" className="ai-approval__always" disabled={busy} onClick={() => onResolve("approve-always")} title="Run this, and let the assistant act without asking for the rest of this conversation">Always allow here</button>
    </footer>
  </section>;
}

function Message({ message, pending, busy, last, compact, onResolve, onRetry }) {
  if (message.role === "user") {
    return <article className="ai-msg ai-msg--user"><div className="ai-msg__bubble">{message.text}</div></article>;
  }
  const working = busy && last && !message.text && !message.error;
  const current = message.activity?.find(item => item.state === "running");
  return <article className="ai-msg ai-msg--assistant">
    {!compact && message.model && <header className="ai-msg__model"><ModelMark family={message.model.family} size={13}/><span>{message.model.label}</span>{message.model.source === "byok" && <em>{message.model.keyLabel}</em>}</header>}
    <Activity items={message.activity}/>
    {message.text && <div className="ai-msg__body mai-md-body">{renderMarkdown(message.text)}</div>}
    {working && <div className="ai-msg__thinking" role="status"><span className="ai-dots" aria-hidden="true"><i/><i/><i/></span><span>{current ? `${current.label}…` : "Thinking…"}</span></div>}
    {message.error && <div className={`ai-msg__error${message.errorCode === "PLAN_REQUIRED" ? " is-plan" : ""}`} role="alert"><span>{message.error}</span>{message.errorCode === "PLAN_REQUIRED"
      ? <button type="button" className="plan-inline-upgrade" onClick={() => requestUpgrade({ feature: "missionAiMessages", message: message.error })}><CrownIcon size={12}/>Upgrade</button>
      : last && onRetry && <button type="button" onClick={onRetry}>Try again</button>}</div>}
    {pending && pending.messageId === message.id && <ApprovalCard pending={pending} busy={busy} compact={compact} onResolve={onResolve}/>}
  </article>;
}

export function AssistantThread({ conversation, compact = false, emptyState = null, onRetry }) {
  const scrollRef = React.useRef(null);
  const stickRef = React.useRef(true);
  const { messages, pending, busy } = conversation;
  const lastAssistant = [...messages].reverse().find(item => item.role === "assistant");

  // Follow the conversation while the reader is at the bottom of it; leave
  // them where they are when they have scrolled up to read something.
  React.useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node && stickRef.current) node.scrollTop = node.scrollHeight;
  }, [messages, pending, busy]);

  return <div
    ref={scrollRef}
    className={`ai-thread ${compact ? "is-compact" : ""}`}
    role="log"
    aria-label="Conversation"
    aria-busy={busy || undefined}
    onScroll={event => { const node = event.currentTarget; stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48; }}
  >
    {!messages.length && emptyState}
    {messages.map(message => <Message
      key={message.id}
      message={message}
      pending={pending}
      busy={busy}
      compact={compact}
      last={message === lastAssistant}
      onResolve={conversation.resolve}
      onRetry={onRetry}
    />)}
  </div>;
}

export function AssistantComposer({ conversation, disabled = false, disabledReason = "", placeholder, compact = false, focusWorkerId = null, draft, onDraft, inputRef, toolbar = null }) {
  const [localDraft, setLocalDraft] = React.useState("");
  const value = draft ?? localDraft;
  const setValue = onDraft ?? setLocalDraft;
  const ownRef = React.useRef(null);
  const textareaRef = inputRef || ownRef;
  const blocked = disabled || Boolean(conversation.pending);

  React.useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, compact ? 120 : 200)}px`;
  }, [value, compact, textareaRef]);

  const submit = async () => {
    const text = value.trim();
    if (!text || blocked || conversation.busy) return;
    setValue("");
    const result = await conversation.send(text, focusWorkerId);
    // A request that never started (no model, a pending approval) gives the
    // text back rather than losing what the operator wrote.
    if (!result) setValue(text);
  };

  const action = conversation.busy
    ? <button type="button" className="ai-composer__stop" onClick={() => void conversation.cancel()} aria-label="Stop answering"><svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/></svg></button>
    : <button type="button" className="ai-composer__send" disabled={!value.trim() || blocked} onClick={() => void submit()} aria-label="Send"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg></button>;

  // With a toolbar — the page's model switcher and approval setting — the
  // controls that shape the next answer sit under the text they apply to,
  // with Send at the end of that row.
  return <div className={`ai-composer ${compact ? "is-compact" : ""} ${toolbar ? "has-toolbar" : ""}`}>
    {conversation.error && <div className="ai-composer__error" role="alert"><span>{conversation.error}</span><button type="button" aria-label="Dismiss" onClick={conversation.clearError}>×</button></div>}
    <div className="ai-composer__field" onMouseDown={event => { if (toolbar && event.target === event.currentTarget) { event.preventDefault(); textareaRef.current?.focus(); } }}>
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        maxLength={8000}
        disabled={disabled}
        aria-label={placeholder}
        placeholder={blocked && conversation.pending ? "Answer the approval above first" : disabledReason || placeholder}
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submit(); }
          // The pane sits among terminals that use Escape; inside the field it
          // only leaves the field.
          if (event.key === "Escape") { event.stopPropagation(); event.currentTarget.blur(); }
        }}
      />
      {toolbar ? <div className="ai-composer__bar"><div className="ai-composer__tools">{toolbar}</div>{action}</div> : action}
    </div>
    {/* The keys on one side, and on the other what the assistant may do
        without asking — the one line under the box that changes meaning. */}
    {!compact && <div className="ai-composer__hint">
      <span className="ai-composer__keys"><kbd>Enter</kbd> to send · <kbd>Shift</kbd> <kbd>Enter</kbd> for a new line</span>
      <span className={`ai-composer__mode ${conversation.autoApprove ? "is-auto" : ""}`}>{conversation.autoApprove ? "Acting without asking in this chat" : "Anything that changes your project asks first"}</span>
    </div>}
  </div>;
}
