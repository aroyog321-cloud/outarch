import React from "react";

// The menu affordance beside a label, drawn with the icon set's stroke and sized
// to the text around it. The text glyph it replaces (a down arrowhead) sits on
// the baseline in Inter, so it read as a stray mark under the label.
export default function Chevron({ className = "chevron" }) {
  return <svg className={className} width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flexShrink: 0, verticalAlign: "-0.125em" }}><path d="m6 9 6 6 6-6"/></svg>;
}
