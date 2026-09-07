import React from "react";

const STORAGE_KEY = "mission-control:interface-preferences:v1";
export const DEFAULT_INTERFACE_PREFERENCES = Object.freeze({
  theme: "orbital",
  typeScale: "comfortable",
  density: "comfortable",
  motion: "full",
  terminalFontSize: 13,
  terminalTheme: "orbital",
  terminalCursor: "bar",
  terminalScrollback: 5000,
  showCommandHints: true
});

// T123 — Restore defaults must be able to state its exact scope before it runs.
// Labels are the same wording the Settings controls use, so the preview names
// what the user actually sees.
const PREFERENCE_LABELS = Object.freeze({
  theme: "Theme",
  typeScale: "Text size",
  density: "Interface density",
  motion: "Motion",
  terminalFontSize: "Terminal font size",
  terminalTheme: "Terminal theme",
  terminalCursor: "Cursor",
  terminalScrollback: "Scrollback",
  showCommandHints: "Show command hints"
});

// Returns the settings a reset would change, and whether that reset does more
// than restyle: lowering scrollback discards buffered output already held by
// mounted terminal panes, which is the one effect this action cannot undo.
export function describePreferenceReset(preferences) {
  const changed = Object.keys(PREFERENCE_LABELS)
    .filter(field => preferences?.[field] !== DEFAULT_INTERFACE_PREFERENCES[field])
    .map(field => PREFERENCE_LABELS[field]);
  const discardsScrollback = Number(preferences?.terminalScrollback) > DEFAULT_INTERFACE_PREFERENCES.terminalScrollback;
  return { changed, discardsScrollback };
}

function normalize(value) {
  return {
    theme: ["orbital", "solar", "contrast"].includes(value?.theme) ? value.theme : DEFAULT_INTERFACE_PREFERENCES.theme,
    typeScale: ["compact", "comfortable", "large"].includes(value?.typeScale) ? value.typeScale : DEFAULT_INTERFACE_PREFERENCES.typeScale,
    density: ["compact", "comfortable", "spacious"].includes(value?.density) ? value.density : DEFAULT_INTERFACE_PREFERENCES.density,
    motion: ["full", "reduced"].includes(value?.motion) ? value.motion : DEFAULT_INTERFACE_PREFERENCES.motion,
    terminalFontSize: Number.isInteger(value?.terminalFontSize) && value.terminalFontSize >= 11 && value.terminalFontSize <= 18 ? value.terminalFontSize : DEFAULT_INTERFACE_PREFERENCES.terminalFontSize,
    terminalTheme: ["orbital", "solar", "contrast"].includes(value?.terminalTheme) ? value.terminalTheme : DEFAULT_INTERFACE_PREFERENCES.terminalTheme,
    terminalCursor: ["bar", "block", "underline"].includes(value?.terminalCursor) ? value.terminalCursor : DEFAULT_INTERFACE_PREFERENCES.terminalCursor,
    terminalScrollback: [1000, 5000, 20000].includes(value?.terminalScrollback) ? value.terminalScrollback : DEFAULT_INTERFACE_PREFERENCES.terminalScrollback,
    showCommandHints: typeof value?.showCommandHints === "boolean" ? value.showCommandHints : DEFAULT_INTERFACE_PREFERENCES.showCommandHints
  };
}

export default function useInterfacePreferences() {
  const [preferences, setPreferences] = React.useState(() => {
    try { return normalize(JSON.parse(window.localStorage.getItem(STORAGE_KEY))); } catch { return { ...DEFAULT_INTERFACE_PREFERENCES }; }
  });

  React.useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch { /* Interface preferences are optional. */ }
  }, [preferences]);

  // T160: the document's color-scheme metadata follows the active theme so the
  // browser paints native scrollbars, form controls and the initial canvas to
  // match, instead of always dark-first.
  React.useEffect(() => {
    const scheme = preferences.theme === "solar" ? "light" : "dark";
    document.documentElement.style.colorScheme = scheme;
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", scheme);
  }, [preferences.theme]);

  const update = React.useCallback((field, value) => setPreferences(current => normalize({ ...current, [field]: value })), []);
  const reset = React.useCallback(() => setPreferences({ ...DEFAULT_INTERFACE_PREFERENCES }), []);
  return { preferences, update, reset };
}
