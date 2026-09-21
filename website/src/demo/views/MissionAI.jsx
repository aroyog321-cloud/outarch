import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, CaretDown, Check, Key, Plus, Sparkle } from '@phosphor-icons/react';
import { AI_SUGGESTIONS } from '../demoData.js';
import { useDemo } from '../useDemo.js';

function Typewriter({ text, animate }) {
  const [shown, setShown] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(text.length); return undefined; }
    const timer = window.setInterval(() => setShown(value => {
      if (value >= text.length) { window.clearInterval(timer); return value; }
      return Math.min(text.length, value + 3);
    }), 16);
    return () => window.clearInterval(timer);
  }, [text, animate]);
  return <>{text.slice(0, shown)}{shown < text.length ? <span className="rx-caret" aria-hidden="true"/> : null}</>;
}

function ActionCard({ message }) {
  const { dispatch } = useDemo();
  const action = message.action;
  return <div className={`ai-action ${action.status === 'approved' ? 'is-approved' : action.status === 'rejected' ? 'is-rejected' : ''}`}>
    <strong><Sparkle size={15} weight="fill" color="#a5a5ff"/>Proposed: {action.title}</strong>
    <ol>{action.steps.map(step => <li key={step}>{step}</li>)}</ol>
    <div className="ai-action__row">
      {action.status === 'pending' ? <>
        <button type="button" className="rx-btn rx-btn--sm rx-btn--primary" onClick={() => dispatch({ type: 'AI_SETTLE', messageId: message.id, approve: true })}>Approve once</button>
        <button type="button" className="rx-btn rx-btn--sm" onClick={() => dispatch({ type: 'AI_SETTLE', messageId: message.id, approve: false })}>Reject</button>
        <span>Also waiting in Needs You</span>
      </> : <span>{action.status === 'approved' ? 'Approved by you and done' : 'Rejected, nothing changed'}</span>}
    </div>
  </div>;
}

function topicOf(text) {
  if (/test|fail(ing)? test/i.test(text)) return 'tests';
  if (/stop|crash|fail/i.test(text)) return 'failed';
  if (/port|server|url|localhost/i.test(text)) return 'ports';
  if (/start.*idle|idle/i.test(text)) return 'idle';
  if (/running|health|status|summar/i.test(text)) return 'running';
  return 'other';
}

export function MissionAiView() {
  const { state, dispatch } = useDemo();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const thread = useRef(null);
  const seen = useRef(new Set(state.ai.messages.filter(message => state.tick - (message.tick ?? -99) > 1).map(message => message.id)));
  const messages = state.ai.messages;

  useLayoutEffect(() => { if (thread.current) thread.current.scrollTop = thread.current.scrollHeight; }, [messages.length, pending]);

  const ask = (topic, text) => {
    setPending(true);
    window.setTimeout(() => { setPending(false); dispatch({ type: 'AI_ASK', topic, text }); }, 700);
  };
  const send = () => { const text = draft.trim(); if (!text || pending) return; setDraft(''); ask(topicOf(text), text); };

  return <>
    <div className="ai-head">
      <span className="ai-tile"><Sparkle size={22} weight="fill"/></span>
      <div><strong>Mission AI</strong><p>Reads your terminals and acts when you say so.</p></div>
      <button type="button" className="rx-btn" onClick={() => dispatch({ type: 'TOAST', toast: { tone: 'info', title: 'Keys & models', detail: 'Built-in models, or your own key from 18 providers' } })}><Key size={16}/>Keys &amp; models</button>
      <button type="button" className="rx-btn rx-btn--text" onClick={() => dispatch({ type: 'AI_NEW' })}><Plus size={15}/>New chat</button>
    </div>
    {messages.length || pending
      ? <div className="ai-thread" ref={thread} data-lenis-prevent="">
        {messages.map(message => {
          const fresh = !seen.current.has(message.id);
          if (fresh) seen.current.add(message.id);
          if (message.role === 'user') return <div key={message.id} className="ai-msg--user">{message.text}</div>;
          return <div key={message.id} className="ai-msg--ai">
            <span className="rx-spark"><Sparkle size={14} weight="fill"/></span>
            <div>
              {message.steps?.length ? <ul className="ai-steps">{message.steps.map(step => <li key={step}><Check size={13} weight="bold"/>{step}</li>)}</ul> : null}
              <div className="ai-msg__text"><Typewriter text={message.text} animate={fresh}/></div>
              {message.action ? <ActionCard message={message}/> : null}
            </div>
          </div>;
        })}
        {pending ? <div className="ai-msg--ai"><span className="rx-spark"><Sparkle size={14} weight="fill"/></span><span className="ai-typing"><i/><i/><i/></span></div> : null}
      </div>
      : <div className="ai-empty">
        <div>
          <span className="ai-tile"><Sparkle size={32} weight="fill"/></span>
          <h4>What should we look at?</h4>
          <p>Ask about any worker, error or port. Mission AI reads the terminals itself, and anything that would change your project is shown to you before it runs.</p>
          <div className="ai-suggest">{AI_SUGGESTIONS.map(item => <button key={item.id} type="button" onClick={() => ask(item.id, item.text)}>{item.text}</button>)}</div>
        </div>
      </div>}
    <div className="ai-composer">
      <textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="Ask about your project, or tell Mission AI what to do" aria-label="Ask Mission AI"/>
      <div className="ai-composer__row">
        <span className="ai-model"><Sparkle size={15} weight="fill"/>Gemini 3.7 Flash<span>Mission AI<CaretDown size={12}/></span></span>
        <label className="ai-auto"><button type="button" className="rx-toggle" role="switch" aria-checked={state.ai.auto} aria-label="Act without asking" onClick={() => dispatch({ type: 'AI_AUTO' })}/>Act without asking</label>
        <button type="button" className="ai-send" disabled={!draft.trim() || pending} onClick={send} aria-label="Send"><ArrowUp size={16} weight="bold"/></button>
      </div>
    </div>
    <div className="ai-foot"><span><kbd>Enter</kbd> to send · <kbd>Shift</kbd> <kbd>Enter</kbd> for a new line</span><span>Anything that changes your project asks first</span></div>
  </>;
}
