import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { missionApi } from "./missionApi.js";
import { MissionAISettings } from "./MissionAI.jsx";
import TrustBoundary from "./TrustBoundary.jsx";
import useReducedMotion from "./useReducedMotion.js";

const MODELS = [
  ["gemini-2.5-flash", "Gemini 2.5 Flash", "Balanced"],
  ["gemini-2.5-pro", "Gemini 2.5 Pro", "Capable"],
  ["gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite", "Economical"],
  ["gemini-2.0-flash", "Gemini 2.0 Flash", "Fast"]
];

const ASK_PRESETS = ["What is happening?", "What is broken?", "What needs me?"];
const PLAN_PRESETS = [
  "Design a safe recipe (a repeatable workspace launch) for this project.",
  "Plan how to recover the failed workers and verify them.",
  "Propose the next evidence-backed steps without executing anything."
];

function actionLabel(action) {
  const target = action.workerId || action.recipeId || action.definition?.id || action.profile?.id || "workspace";
  return `${String(action.type || "action").replaceAll("-", " ")} · ${target}`;
}

function modelLabel(model) {
  return MODELS.find(([id]) => id === model)?.[1] || model || "Gemini 2.5 Flash";
}

/* Lightweight markdown parser and renderer — no external dependency.
   T171/T172 — parse once into stable AST blocks, and reveal in bounded time-budgeted
   chunks without reparsing the accumulated string on every frame.
   Handles: **bold**, `inline code`, ``` code blocks ```, # headings,
   - bullet lists, numbered lists, > blockquotes, and plain paragraphs. */
export function parseMarkdownBlocks(text) {
  if (!text) return [];
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      const rawCode = codeLines.join("\n");
      blocks.push({
        type: "code",
        lang,
        codeLines,
        text: rawCode,
        length: rawCode.length + 6
      });
      i++;
      continue;
    }
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push({
        type: "heading",
        level,
        text: headingMatch[2],
        length: headingMatch[2].length
      });
      i++;
      continue;
    }
    if (line.startsWith("> ")) {
      blocks.push({
        type: "blockquote",
        text: line.slice(2),
        length: line.slice(2).length
      });
      i++;
      continue;
    }
    if (/^[-*+]\s/.test(line)) {
      const items = [];
      let totalLength = 0;
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        const itemText = lines[i].replace(/^[-*+]\s/, "");
        items.push(itemText);
        totalLength += itemText.length;
        i++;
      }
      blocks.push({
        type: "list",
        ordered: false,
        items,
        length: totalLength
      });
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      let totalLength = 0;
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        const itemText = lines[i].replace(/^\d+\.\s/, "");
        items.push(itemText);
        totalLength += itemText.length;
        i++;
      }
      blocks.push({
        type: "list",
        ordered: true,
        items,
        length: totalLength
      });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    blocks.push({
      type: "para",
      text: line,
      length: line.length
    });
    i++;
  }
  return blocks;
}

function inlineMarkdown(text) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="mai-md-inline-code">{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function renderBlock(block, visibleLen, key) {
  if (block.type === "code") {
    // Preserve layout: pre and code container are always intact so syntax/layout never collapses
    const visibleCode = visibleLen >= block.length ? block.codeLines.join("\n") : block.text.slice(0, visibleLen);
    return <div key={key} className="mai-md-code-block">{block.lang && <span className="mai-md-code-lang">{block.lang}</span>}<pre><code>{visibleCode}</code></pre></div>;
  }
  if (block.type === "heading") {
    const Tag = `h${Math.min(block.level + 2, 6)}`;
    const slice = block.text.slice(0, visibleLen);
    return <Tag key={key} className="mai-md-heading">{inlineMarkdown(slice)}</Tag>;
  }
  if (block.type === "blockquote") {
    const slice = block.text.slice(0, visibleLen);
    return <blockquote key={key} className="mai-md-blockquote">{inlineMarkdown(slice)}</blockquote>;
  }
  if (block.type === "list") {
    let budget = visibleLen;
    const items = [];
    for (let idx = 0; idx < block.items.length; idx++) {
      if (budget <= 0) break;
      const item = block.items[idx];
      const slice = item.slice(0, budget);
      items.push(<li key={idx}>{inlineMarkdown(slice)}</li>);
      budget -= item.length;
    }
    return block.ordered
      ? <ol key={key} className="mai-md-list mai-md-list--ordered">{items}</ol>
      : <ul key={key} className="mai-md-list">{items}</ul>;
  }
  const slice = block.text.slice(0, visibleLen);
  return <p key={key} className="mai-md-para">{inlineMarkdown(slice)}</p>;
}

export function renderMarkdown(text) {
  if (!text) return null;
  const blocks = parseMarkdownBlocks(text);
  return blocks.map((block, idx) => renderBlock(block, block.length, idx));
}

function StreamingReveal({ text, animate = true }) {
  // T135 / MC-13: the client-side reveal is animation — honour reduced motion
  // (OS or in-app) by showing the whole answer at once.
  const reducedMotion = useReducedMotion();
  const shouldAnimate = animate && !reducedMotion;
  // T171 / T172 — parse once into stable AST blocks. Bounded time-based chunk reveal
  // instead of reparsing the whole Markdown string on every frame.
  const blocks = React.useMemo(() => parseMarkdownBlocks(text), [text]);
  const totalLength = text ? text.length : 0;
  const [revealedChars, setRevealedChars] = React.useState(shouldAnimate ? 0 : totalLength);
  const rafRef = React.useRef(null);
  const lastTimeRef = React.useRef(0);
  const streaming = shouldAnimate && revealedChars < totalLength;

  React.useEffect(() => {
    if (!shouldAnimate || !totalLength) {
      setRevealedChars(totalLength);
      return;
    }
    let pos = 0;
    // Bounded chunk reveal: 24 chars per step at a 25ms budget
    const CHUNK = 24;
    const FRAME_BUDGET_MS = 25;
    const tick = timestamp => {
      if (!lastTimeRef.current || timestamp - lastTimeRef.current >= FRAME_BUDGET_MS) {
        pos = Math.min(pos + CHUNK, totalLength);
        setRevealedChars(pos);
        lastTimeRef.current = timestamp;
      }
      if (pos < totalLength) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [totalLength, shouldAnimate]);

  // Render pre-parsed blocks with the revealed character budget
  let remaining = revealedChars;
  const elements = [];
  for (let idx = 0; idx < blocks.length; idx++) {
    if (remaining <= 0) break;
    const block = blocks[idx];
    if (remaining >= block.length) {
      elements.push(renderBlock(block, block.length, idx));
      remaining -= block.length;
    } else {
      elements.push(renderBlock(block, remaining, idx));
      remaining = 0;
    }
  }

  // T134: the reveal is cosmetic. It is not inside a live region (the transcript
  // is not one), so partial chunks are never announced; `aria-busy` stays as a
  // belt-and-braces hint for any AT that does watch subtree mutations. The
  // settled answer is announced once via the dedicated region in MissionAIScreen.
  return <div aria-busy={streaming || undefined}>{elements}</div>;
}

// One plain-text line for the polite live region — the substance of the answer,
// announced once when it settles rather than character-by-character.
function announceAnswer(answer) {
  const lead = String(answer?.text || "").replace(/\s+/g, " ").trim().slice(0, 320);
  const range = answer?.estimate ? ` Estimated ${answer.estimate.minimumHours} to ${answer.estimate.maximumHours} hours.` : "";
  return lead ? `Mission AI answered. ${lead}${range}` : "";
}

function Answer({ answer, onEvidence }) {
  return <div className="mai-response-content">
    <div className="mai-md-body"><StreamingReveal text={answer.text} animate /></div>
    {answer.estimate && <section className="mai-estimate"><div><span>Estimated range</span><strong>{answer.estimate.minimumHours}–{answer.estimate.maximumHours} hours</strong><small>{answer.estimate.confidence} confidence</small></div><div><span>Assumptions</span><p>{answer.estimate.assumptions?.length ? answer.estimate.assumptions.join(" · ") : "None declared"}</p></div><div><span>Missing evidence</span><p>{answer.estimate.missingEvidence?.length ? answer.estimate.missingEvidence.join(" · ") : "None declared"}</p></div></section>}
    {answer.citations?.length > 0 && <div className="mai-evidence"><span>Evidence used</span>{answer.citations.map(id => <button key={id} onClick={onEvidence}>{id}</button>)}</div>}
  </div>;
}

function Plan({ proposal, onNeedsYou }) {
  return <div className="mai-plan">
    <header><span>Validated locally · not executed</span><strong>{proposal.plan.summary}</strong></header>
    <ol>{proposal.plan.actions.map((action, index) => <li key={`${action.type}-${index}`}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{actionLabel(action)}</strong><p>{action.reason}</p></div><span className={/kill|delete|input/i.test(action.type) ? "risk-high" : "risk-low"}>{/kill|delete|input/i.test(action.type) ? "Review" : "Bounded"}</span></li>)}</ol>
    <footer><span>Expires in 15 minutes. Nothing runs from this screen.</span><button onClick={onNeedsYou}>Review in Needs You</button></footer>
  </div>;
}

export default function MissionAIScreen({ initialPrompt = "", onConfigure, onNeedsYou, onEvidence }) {
  const [status, setStatus] = React.useState(null);
  const [mode, setMode] = React.useState("ask");
  const [question, setQuestion] = React.useState(initialPrompt || ASK_PRESETS[0]);
  const [turns, setTurns] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  // T134 — a single settled sentence for the polite live region, replaced (not
  // appended) on each result so a screen reader announces one useful summary.
  const [announcement, setAnnouncement] = React.useState("");

  const refresh = React.useCallback(async () => {
    try { setStatus(await missionApi().request("missionAi.status")); }
    catch (value) { setError(value.message || String(value)); }
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => {
    if (!initialPrompt) return;
    setMode("ask");
    setQuestion(initialPrompt.slice(0, 1200));
  }, [initialPrompt]);

  const changeModel = async model => {
    if (busy || model === status?.model) return;
    setBusy(true);
    setError("");
    try {
      setStatus(await missionApi().request("missionAi.configure", {
        configuration: { model, includeTerminalEvidence: status?.includeTerminalEvidence === true }
      }));
    } catch (value) { setError(value.message || String(value)); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    const prompt = question.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError("");
    setAnnouncement("");
    try {
      if (mode === "ask") {
        const answer = await missionApi().request("missionAi.ask", { question: prompt });
        setTurns(current => [...current, { id: `${Date.now()}-answer`, prompt, answer }]);
        setAnnouncement(announceAnswer(answer));
      } else {
        const proposal = await missionApi().request("missionSupervisor.plan", { instruction: prompt });
        setTurns(current => [...current, { id: `${Date.now()}-plan`, prompt, proposal }]);
        const count = proposal?.plan?.actions?.length || 0;
        setAnnouncement(`Mission AI proposed a plan with ${count} action${count === 1 ? "" : "s"}. Review it in Needs You before anything runs.`);
      }
      setQuestion("");
    } catch (value) { setError(value.message || String(value)); }
    finally { setBusy(false); }
  };

  const presets = mode === "ask" ? ASK_PRESETS : PLAN_PRESETS;
  return <div className="mission-ai-screen">
    <header className="mai-header">
      <div className="mai-title"><span className="mai-orb">AI</span><div><span>Mission AI</span><h1>Project intelligence, grounded in evidence.</h1></div></div>
      <div className="mai-header-actions">
        {status?.configured && <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="mai-model" disabled={busy}><span><small>Model</small><strong>{modelLabel(status.model)}</strong></span><i>⌄</i></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="mission-ai-model-menu mai-model-menu" align="end" sideOffset={8}>{MODELS.map(([id, label, detail]) => <DropdownMenu.Item key={id} className={status.model === id ? "is-selected" : ""} onSelect={() => void changeModel(id)}><span><strong>{label}</strong><small>{detail}</small></span><b>{status.model === id ? "✓" : ""}</b></DropdownMenu.Item>)}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>}
        <button className="mai-settings-link" onClick={onConfigure}>AI settings</button>
      </div>
    </header>

    {!status?.configured ? <div className="mai-setup"><div><span className="mai-setup-mark">◇</span><h2>Connect Mission AI securely</h2><p>Add an OS-encrypted Gemini key. Credentials never enter project files, renderer storage, or mission history.</p></div><MissionAISettings onOpen={refresh}/></div> : <div className="mai-workspace">
      <aside className="mai-context">
        <TrustBoundary
          tone="ai"
          title={mode === "ask" ? "Read-only project interpretation" : "Proposal only until you approve"}
          summary="Mission AI cites the current supervision snapshot without owning terminals or tools."
          facts={[
            { label: "Authority", value: mode === "ask" ? "Read-only answers" : "Approval-gated proposal" },
            { label: "Evidence", value: status.includeTerminalEvidence ? "Bounded output permitted" : "Terminal output omitted" },
            { label: "Storage", value: "Provider storage disabled" }
          ]}
        />
        <button onClick={onEvidence}>Open project evidence</button>
      </aside>

      <main className="mai-chat">
        <div className="mai-mode" role="group" aria-label="Mission AI mode"><button type="button" aria-pressed={mode === "ask"} className={mode === "ask" ? "is-current" : ""} onClick={() => { setMode("ask"); setQuestion(ASK_PRESETS[0]); }}>Ask</button><button type="button" aria-pressed={mode === "plan"} className={mode === "plan" ? "is-current" : ""} onClick={() => { setMode("plan"); setQuestion(PLAN_PRESETS[0]); }}>Plan actions</button><span>{mode === "ask" ? "Read-only interpretation" : "Approval-gated proposal"}</span></div>
        {/* T134 — the transcript is a navigable log, not a live region, so the
            client-side reveal never announces partial text. The settled result
            is announced once through the dedicated polite region below. */}
        <div className="mai-thread" role="log" aria-label="Mission AI conversation">
          {!turns.length && !busy && <section className="mai-welcome"><span>AI</span><h2>What do you need to understand?</h2><p>Ask about current workers, failures, changes, evidence, or the decisions waiting for you.</p></section>}
          {turns.map(turn => <React.Fragment key={turn.id}><article className="mai-message is-user"><span>You</span><p>{turn.prompt}</p></article><article className="mai-message is-ai"><span>Mission AI</span>{turn.answer ? <Answer answer={turn.answer} onEvidence={onEvidence}/> : <Plan proposal={turn.proposal} onNeedsYou={onNeedsYou}/>}</article></React.Fragment>)}
          {busy && <div className="mai-thinking" role="status"><i/><div><strong>{mode === "ask" ? "Reading project evidence" : "Validating a bounded plan"}</strong><small>No action is being executed.</small></div></div>}
          {error && <div className="mai-error" role="alert"><strong>Mission AI could not complete the request</strong><p>{error}</p></div>}
        </div>
        <div className="mai-live-announce" aria-live="polite" aria-atomic="true">{announcement}</div>
        <div className="mai-composer">
          <div className="mai-prompts">{presets.map(value => <button key={value} onClick={() => setQuestion(value)}>{value}</button>)}</div>
          <div><textarea aria-label="Ask Mission AI" maxLength="1200" value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void submit(); }} placeholder={mode === "ask" ? "Ask about your project…" : "Describe the outcome you want planned…"}/><button disabled={busy || !question.trim()} onClick={() => void submit()}>{busy ? "Working…" : mode === "ask" ? "Ask Mission AI" : "Build plan"}<kbd>Ctrl ↵</kbd></button></div>
          <small>Plans move to Needs You for local review and approval.</small>
        </div>
      </main>
    </div>}
  </div>;
}
