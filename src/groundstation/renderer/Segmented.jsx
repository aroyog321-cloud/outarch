import React from "react";

/**
 * T151 — the segmented-choice primitive.
 *
 * "Pick exactly one of these" was written four times in four shapes: the
 * Settings control (a real radiogroup), the Needs You queue filters and the
 * History filters (bare buttons with an `is-current` class and no exclusive
 * semantics at all), and the Groundstation manifest chips (`aria-pressed`,
 * which says "this toggle is on" rather than "this is the one of five that is
 * selected"). Three of the four announced the wrong thing, and all four had to
 * be maintained separately.
 *
 * One implementation, two presentations:
 *
 *   `SegmentedChoice` — a labelled setting: label, explanation, choices.
 *   `FilterGroup`     — a bare row of exclusive filters, optionally counted.
 *
 * Both render the same radiogroup so assistive technology hears "3 of 5" and
 * the arrow keys behave, and both keep the class names the existing stylesheets
 * already target, so consolidating the markup changes no pixels.
 */

function useRovingSelection(values, value, onChange) {
  // Arrow keys move the selection, which for a radiogroup IS the focus: a
  // radiogroup holds one tab stop, and moving within it selects.
  return React.useCallback(event => {
    const index = values.indexOf(value);
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1
      : 0;
    if (!step) {
      if (event.key === "Home") { event.preventDefault(); onChange(values[0]); }
      else if (event.key === "End") { event.preventDefault(); onChange(values[values.length - 1]); }
      return;
    }
    event.preventDefault();
    const next = (index < 0 ? 0 : index + step + values.length) % values.length;
    onChange(values[next]);
  }, [values.join("|"), value, onChange]);
}

function Options({ options, value, onChange, className = "", label }) {
  const values = options.map(option => option.value);
  const onKeyDown = useRovingSelection(values, value, onChange);
  const selected = values.includes(value) ? value : values[0];
  return <div className={className} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
    {options.map(option => {
      const isSelected = option.value === selected;
      return <button
        key={String(option.value)}
        type="button"
        role="radio"
        aria-checked={isSelected}
        // One tab stop for the group; the arrows move within it.
        tabIndex={isSelected ? 0 : -1}
        className={`${option.className || ""} ${isSelected ? "is-current is-selected" : ""} ${option.count === 0 ? "is-zero" : ""}`.trim()}
        onClick={() => onChange(option.value)}
      >
        {option.label}
        {Number.isFinite(option.count) && <b>{option.count}</b>}
      </button>;
    })}
  </div>;
}

export function SegmentedChoice({ label, detail, value, options, onChange }) {
  return <div className="setting-control">
    <div><strong>{label}</strong><p>{detail}</p></div>
    <Options className="segmented-control" label={label} options={options} value={value} onChange={onChange}/>
  </div>;
}

export function FilterGroup({ label, value, options, onChange, className = "" }) {
  return <Options className={className} label={label} options={options} value={value} onChange={onChange}/>;
}

export default FilterGroup;
