import React from "react";

const TONES = new Set(["neutral", "ready", "running", "warning", "critical", "idle"]);

export default function StatusChip({ tone = "neutral", label, className = "", ...props }) {
  const safeTone = TONES.has(tone) ? tone : "neutral";
  return <span className={`status-chip tone-${safeTone} ${className}`.trim()} {...props}><i aria-hidden="true"/>{label}</span>;
}

/* ===========================================================================
   T141 — the resource states, told apart

   These seven were being drawn with whatever chip was nearest, which made the
   most important distinctions in the app invisible. They are not shades of the
   same thing:

     loading       we do not know yet — never a zero, never an empty state
     ready         we asked, and it answered
     empty         we asked, it answered, and there is nothing
     stale         we have an older answer; the refresh failed
     offline       not connected right now
     unconfigured  it works, but you have not set it up
     unavailable   this build or platform cannot do it at all
     error         we tried and it failed
     disabled      you cannot do this right now, for a stated reason

   The pairs that matter most, because collapsing them is how an app lies:
   `empty` vs `loading` (nothing yet vs nothing at all), `unavailable` vs
   `disabled` (cannot ever vs cannot now), and `stale` vs `ready` (old truth vs
   current truth). Each gets its own tone *and* its own accessible semantics —
   colour alone is not a distinction for everyone.
   ======================================================================== */

export const RESOURCE_STATES = Object.freeze({
  loading:      { tone: "neutral",  label: "Loading",       busy: true },
  ready:        { tone: "ready",    label: "Ready" },
  empty:        { tone: "idle",     label: "Nothing yet" },
  stale:        { tone: "warning",  label: "Stale" },
  offline:      { tone: "idle",     label: "Offline" },
  unconfigured: { tone: "idle",     label: "Not set up" },
  unavailable:  { tone: "neutral",  label: "Unavailable" },
  error:        { tone: "critical", label: "Failed",        alert: true },
  disabled:     { tone: "idle",     label: "Unavailable now" }
});

export function ResourceState({ state, label, detail, className = "", ...props }) {
  const spec = RESOURCE_STATES[state] || RESOURCE_STATES.unavailable;
  const text = label || spec.label;
  return <span
    className={`status-chip resource-state is-${state in RESOURCE_STATES ? state : "unavailable"} tone-${spec.tone} ${className}`.trim()}
    // An error is an interruption; everything else is a reading. `aria-busy`
    // is what tells a screen reader the value is not final yet, which is the
    // difference between "nothing" and "not yet".
    role={spec.alert ? "alert" : "status"}
    aria-busy={spec.busy || undefined}
    title={detail || undefined}
    {...props}
  ><i aria-hidden="true"/>{text}{detail && <small>{detail}</small>}</span>;
}
