import React from "react";

// The AI mark: two sparkles filled with the assistant gradient. It is how an
// AI entry point is told apart from the blue primary actions around it — the
// same blue alone read as "another button", and the old glyph at 12px read as
// a padlock. The stops are tokens, so the palette owns the colours.
export function AiGlyph({ size = 16, className = "" }) {
  const id = `ai-glyph-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return <svg className={`ai-glyph ${className}`.trim()} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={id} x1="2" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
        <stop offset="0" style={{ stopColor: "var(--mc-ai-glyph-from, var(--mc-ai-strong))" }}/>
        <stop offset="1" style={{ stopColor: "var(--mc-ai-glyph-to, var(--mc-ai-violet))" }}/>
      </linearGradient>
    </defs>
    <path fill={`url(#${id})`} d="M10 3Q11.1 10.9 18 12Q11.1 13.1 10 21Q8.9 13.1 2 12Q8.9 10.9 10 3Z"/>
    <path fill={`url(#${id})`} d="M18.5 2Q19 5 22 5.5Q19 6 18.5 9Q18 6 15 5.5Q18 5 18.5 2Z"/>
  </svg>;
}
