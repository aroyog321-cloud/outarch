import React from "react";

// T107 / T151 — one accessible tab implementation for the whole renderer.
//
// Four surfaces had hand-built tablists that declared `role="tablist"` and
// `aria-selected` and stopped there: no tabpanel, no `aria-controls`, no
// roving tabindex, and no arrow-key movement. That combination is worse than
// no ARIA at all, because it promises a screen-reader user a tab widget and
// then behaves like a row of unrelated buttons.
//
// This follows the WAI-ARIA tabs pattern with automatic activation, which is
// correct here: every panel is already rendered from local state, so selecting
// a tab is instant and there is nothing to defer.

export const tabId = (group, value) => `${group}-tab-${value}`;
export const panelId = (group, value) => `${group}-panel-${value}`;

export default function TabSet({ group, label, value, onChange, tabs, className = "" }) {
  const listRef = React.useRef(null);
  const items = tabs.filter(Boolean);

  const move = (event, index) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next = null;
    if (event.key in keys) next = (index + keys[event.key] + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    onChange(items[next].value);
    // Focus follows selection, so the next Tab press leaves the tablist for the
    // panel rather than walking the remaining tabs.
    listRef.current?.querySelector(`#${CSS.escape(tabId(group, items[next].value))}`)?.focus();
  };

  return <div ref={listRef} className={className} role="tablist" aria-label={label}>
    {items.map((tab, index) => {
      const selected = tab.value === value;
      return <button
        key={tab.value}
        type="button"
        id={tabId(group, tab.value)}
        role="tab"
        aria-selected={selected}
        aria-controls={panelId(group, tab.value)}
        tabIndex={selected ? 0 : -1}
        className={selected ? "is-current" : ""}
        onClick={() => onChange(tab.value)}
        onKeyDown={event => move(event, index)}
      >{tab.label}{tab.badge !== undefined && <span>{tab.badge}</span>}</button>;
    })}
  </div>;
}

// Applied to a panel element that already exists, so adopting the pattern never
// adds a wrapper the stylesheets would have to be taught about. The panel is
// focusable so activating a tab has somewhere to send the reader, and it is
// labelled by its own tab rather than repeating the tab's text.
export function tabPanelProps(group, value) {
  return { id: panelId(group, value), role: "tabpanel", "aria-labelledby": tabId(group, value), tabIndex: 0 };
}

// The wrapper form, for panels that do not already have one element of their own.
export function TabPanel({ group, value, active, className = "", children }) {
  if (!active) return null;
  return <div
    id={panelId(group, value)}
    role="tabpanel"
    aria-labelledby={tabId(group, value)}
    tabIndex={0}
    className={className}
  >{children}</div>;
}
