import React from "react";
import useReducedMotion from "./useReducedMotion.js";

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

export function StreamingReveal({ text, animate = true }) {
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
