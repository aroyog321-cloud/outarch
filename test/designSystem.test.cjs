"use strict";

// The design-system contract in MISSION_CONTROL_DESIGN_SYSTEM.md, enforced.
//
// A design system that lives only in a document is a document. Each test below
// pins one rule from that file, so a change that breaks the contract fails here
// rather than drifting until someone notices a black slab in the light theme.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const RENDERER = path.join(root, "src", "groundstation", "renderer");
const read = file => fs.readFileSync(path.join(RENDERER, file), "utf8");
const tokens = () => read(path.join("redesign", "tokens-bridge.css"));
const surfaces = () => read(path.join("redesign", "surfaces.css"));

const REDESIGN = ["base.css", "cockpit.css", "screens.css", "surfaces.css", "workspace.css", "tokens-bridge.css"]
  .map(name => path.join("redesign", name));

/* ------------------------------------------------------------ T143 layers */

test("T143 — the three token layers exist and read downwards", () => {
  const source = tokens();
  // Primitive: the raw scale, named for what it is.
  for (const primitive of ["--mc-void:", "--mc-canvas:", "--mc-surface-2:", "--mc-duration-fast:", "--mc-ease-standard:"]) {
    assert.ok(source.includes(primitive), `missing primitive ${primitive}`);
  }
  // Semantic: named for what it means, and composed from primitives.
  for (const semantic of ["--mc-accent:", "--mc-ok:", "--mc-warning:", "--mc-danger:", "--mc-ai:", "--mc-text-dim:"]) {
    assert.ok(source.includes(semantic), `missing semantic ${semantic}`);
  }
  assert.match(source, /--mc-motion-fast: var\(--mc-duration-fast\) var\(--mc-ease-standard\);/,
    "a semantic motion token must be composed from primitives, not restate them");

  // The contract is written down, and names the layers it enforces.
  const doc = fs.readFileSync(path.join(root, "MISSION_CONTROL_DESIGN_SYSTEM.md"), "utf8");
  for (const heading of ["Primitive", "Semantic", "Component"]) assert.ok(doc.includes(heading));
});

/* ----------------------------------------------------------- T145 theming */

test("T145 — theme blocks redefine semantic tokens and never name a component", () => {
  const source = tokens();
  for (const theme of [".theme-solar", ".theme-contrast"]) {
    const at = source.indexOf(theme);
    assert.ok(at > -1, `${theme} must exist`);
    const block = source.slice(at, source.indexOf("}", source.indexOf("{", at)));
    // Every declaration inside a theme block is a custom property.
    const declarations = block.split(";").map(line => line.trim()).filter(line => line.includes(":") && !line.startsWith("/*") && !line.startsWith(theme));
    for (const declaration of declarations) {
      assert.match(declaration.split(":")[0].trim(), /^--/,
        `${theme} sets "${declaration.slice(0, 60)}" — a theme may only redefine tokens`);
    }
  }
});

/* ------------------------------------------------------- T147 status roles */

test("T147 — one status colour mapping, with soft fills, in every theme", () => {
  const source = tokens();
  for (const role of ["--mc-ok", "--mc-warning", "--mc-danger", "--mc-accent", "--mc-ai"]) {
    assert.ok(source.includes(`${role}:`), `missing status role ${role}`);
    assert.ok(source.includes(`${role}-soft:`), `${role} needs a soft fill so components never mix their own alpha`);
    // Redefined by both alternative themes, not just the default.
    const occurrences = source.split(`${role}:`).length - 1;
    assert.ok(occurrences >= 2, `${role} is defined once; every theme must restate it (found ${occurrences})`);
  }
  const doc = fs.readFileSync(path.join(root, "MISSION_CONTROL_DESIGN_SYSTEM.md"), "utf8");
  assert.match(doc, /The accent is not a status/);
  // Running is green as of 2026-09-05. The rule that survived the change is
  // the one that mattered: green must be engine-reported, never assumed.
  assert.match(doc, /Green is engine-reported liveness, never an assumption/);
  assert.match(doc, /if the engine did\s*\n?\s*not report it, it is not green/);
});

/* ---------------------------------------------------------- T146 density */

test("T146 — density redefines documented metrics and nothing else", () => {
  const base = read(path.join("redesign", "base.css"));
  for (const mode of ["compact", "comfortable", "spacious"]) {
    const at = base.indexOf(`.shell.density-${mode}`);
    assert.ok(at > -1, `density-${mode} must exist`);
    const block = base.slice(base.indexOf("{", at), base.indexOf("}", at));
    for (const key of ["--mc-space-1", "--mc-space-10", "--mc-control-height", "--mc-manifest-row-height"]) {
      assert.ok(block.includes(key), `density-${mode} must set ${key}`);
    }
    const declarations = block.split(";").map(line => line.replace("{", "").trim()).filter(line => line.includes(":"));
    for (const declaration of declarations) {
      assert.match(declaration.split(":")[0].trim(), /^--/,
        `density-${mode} sets "${declaration.slice(0, 50)}" — density may only move tokens`);
    }
  }
});

/* ------------------------------------------------- T148 / T154 / T165 motion */

test("T148/T154 — zero motion has exactly one owner, covering both triggers", () => {
  const owner = surfaces();
  assert.match(owner, /@media \(prefers-reduced-motion: reduce\)/, "the OS preference");
  assert.match(owner, /\.shell\.motion-reduced,/, "and the in-app Motion setting");
  // Layer one: stilling the tokens stops everything composed from them.
  assert.match(owner, /--mc-duration-fast: 0ms;/);
  assert.match(owner, /--mc-duration-base: 0ms;/);
  assert.match(owner, /--mc-duration-enter: 0ms;/);
  // Layer two: the blanket, for legacy stylesheets with hardcoded timings.
  assert.match(owner, /animation-duration: \.01ms !important;/);

  // And it really is the only owner: no other stylesheet may reintroduce a
  // blanket kill-switch, which is what made this unmaintainable before.
  const others = fs.readdirSync(RENDERER).filter(name => name.endsWith(".css"))
    .concat(REDESIGN.filter(name => !name.endsWith("surfaces.css")));
  for (const name of others) {
    const source = read(name);
    const blanket = /\.motion-reduced\s*\*|\*,\s*\*::before[\s\S]{0,120}animation-duration:\s*\.01ms/;
    assert.doesNotMatch(source, blanket, `${name} reintroduces a blanket reduced-motion rule; surfaces.css owns it`);
  }
});

test("T165 — motion never animates layout", () => {
  for (const name of REDESIGN) {
    const source = read(name).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of source.matchAll(/transition:\s*([^;{}]+);/g)) {
      assert.doesNotMatch(
        match[1],
        /(^|[\s,])(width|height|margin|padding|top|left|right|bottom)(\s|,|$)/,
        `${name} animates layout ("${match[1].trim().slice(0, 60)}") — a reflow during a state change reads as instability`
      );
    }
  }
});

/* ------------------------------------------------------ T149 cascade rules */

test("T149 — the redesign layer wins on specificity, not on import-order luck", () => {
  const main = read("main.jsx");
  const order = [...main.matchAll(/["']\.\/([^"']+\.css)["']/g)].map(match => match[1]);
  // Everything in the redesign layer loads after every legacy stylesheet.
  const firstRedesign = order.findIndex(name => name.startsWith("redesign/"));
  assert.ok(firstRedesign > -1);
  assert.ok(
    order.slice(firstRedesign).every(name => name.startsWith("redesign/")),
    "a legacy stylesheet loads after the redesign layer, so the layer's authority depends on ordering luck"
  );

  // Component rules in the redesign layer reach for the documented ceiling.
  const screens = read(path.join("redesign", "screens.css"));
  assert.ok(
    (screens.match(/#root#root \.shell/g) || []).length > 50,
    "the documented specificity ceiling is #root#root .shell"
  );

  const doc = fs.readFileSync(path.join(root, "MISSION_CONTROL_DESIGN_SYSTEM.md"), "utf8");
  assert.match(doc, /may only go down/, "the ratchets must be documented as one-way");
});

/* ------------------------------------------------------------ T141 states */

test("T141 — nine resource states, each distinguishable without colour", () => {
  const chip = read("StatusChip.jsx");
  const styles = surfaces();
  const states = ["loading", "ready", "empty", "stale", "offline", "unconfigured", "unavailable", "disabled", "error"];

  for (const state of states) {
    assert.ok(chip.includes(`${state}:`), `RESOURCE_STATES is missing ${state}`);
    assert.match(styles, new RegExp(`\.resource-state\.is-${state}`), `${state} has no visual treatment`);
  }

  // The three pairs that must never look the same, because collapsing them is
  // how the app would lie. Each pair differs by something other than colour.
  const treatment = state => {
    const at = styles.indexOf(`.resource-state.is-${state} {`);
    return styles.slice(at, styles.indexOf("}", at));
  };
  assert.notEqual(treatment("empty"), treatment("loading"));
  assert.match(styles, /\.resource-state\.is-empty > i \{ display: none; \}/, "empty shows no dot at all");
  assert.match(styles, /\.resource-state\.is-loading > i \{ animation:/, "loading is the state about time passing");
  assert.match(treatment("unavailable"), /border-style: dotted/);
  assert.match(treatment("offline"), /border-style: dashed/);
  assert.notEqual(treatment("stale"), treatment("ready"));

  // Semantics, not just paint: an error interrupts, a pending read is busy.
  assert.match(chip, /role=\{spec\.alert \? "alert" : "status"\}/);
  assert.match(chip, /aria-busy=\{spec\.busy \|\| undefined\}/);
  assert.match(chip, /error:\s*\{ tone: "critical",[^}]*alert: true \}/);
  assert.match(chip, /loading:\s*\{ tone: "neutral",[^}]*busy: true \}/);
});

/* ---------------------------------------------------------- T142 feedback */

test("T142 — failures and actionable toasts persist; reassurance passes", () => {
  const toasts = read("ToastSystem.jsx");
  assert.match(toasts, /const persistent = hasAction \|\| type === "danger";/);
  assert.match(toasts, /const duration = options\.duration \?\? \(persistent \? 0 : 4500\);/);
  // Escape still closes a focused toast, so persistence never becomes a trap.
  assert.match(toasts, /event\.key === "Escape"/);
});

/* --------------------------------------------------- T157/T158/T159 text + cursor */

test("T158 — two truncation utilities, and nothing truncated loses its value", () => {
  const styles = surfaces();
  assert.match(styles, /\.mc-truncate \{[\s\S]{0,160}text-overflow: ellipsis;/);
  // Paths clip at the start, because their meaningful end is the last segment.
  const pathRule = styles.slice(styles.indexOf(".mc-truncate-path {"), styles.indexOf("}", styles.indexOf(".mc-truncate-path {")));
  assert.match(pathRule, /direction: rtl;/);
  assert.match(pathRule, /text-align: left;/);
  assert.match(pathRule, /unicode-bidi: isolate;/, "isolation stops surrounding punctuation being reordered");
  // A truncated element with no full value is flagged rather than passing silently.
  assert.match(styles, /:is\(\.mc-truncate, \.mc-truncate-path\):not\(\[title\]\):not\(\[aria-label\]\)/);
});

test("T159 — cursor affordances never contradict what a control can do", () => {
  const styles = surfaces();
  assert.match(styles, /\[role="button"\], \[role="tab"\][\s\S]{0,220}cursor: pointer;/);
  assert.match(styles, /\[aria-disabled="true"\] \{\s*\n?\s*cursor: not-allowed;/);
  assert.match(styles, /\[role="separator"\]\[aria-orientation="vertical"\] \{ cursor: col-resize; \}/);
  assert.match(styles, /\[role="separator"\]\[aria-orientation="horizontal"\] \{ cursor: row-resize; \}/);
  // Evidence stays selectable even inside a clickable row — copying it is the point.
  assert.match(styles, /:is\(code, pre, \.mc-truncate-path, \[data-evidence\]\)[\s\S]{0,80}user-select: text;/);
});

test("T157 — case convention is documented and followed by navigation", () => {
  const app = read("App.jsx");
  // The document is prose and wraps, so match it the way prose reads.
  const doc = fs.readFileSync(path.join(root, "MISSION_CONTROL_DESIGN_SYSTEM.md"), "utf8").replace(/\s+/g, " ");
  assert.match(doc, /Title Case/);
  assert.match(doc, /sentence case/);

  // Navigation names places, so it is Title Case.
  const navigation = app.slice(app.indexOf("const NAVIGATION"), app.indexOf("const PRIMARY_NAV_COUNT"));
  for (const [, label] of navigation.matchAll(/\["[a-z-]+", "([^"]+)"/g)) {
    for (const word of label.split(" ")) {
      assert.match(word, /^[A-Z]/, `navigation label "${label}" must be Title Case`);
    }
  }
  // Actions read as sentences: only the first word is capitalised.
  for (const action of ["Add terminal worker", "Restore defaults", "Send test", "Start idle"]) {
    assert.ok(app.includes(action), `expected the sentence-case action "${action}"`);
  }
});

/* ------------------------------------------------ T151 primitives consolidation */

test("T151 — common primitives are consolidated into shared, accessible components", () => {
  const tabSet = read("TabSet.jsx");
  const segmented = read("Segmented.jsx");
  const chip = read("StatusChip.jsx");
  const skeleton = read("LoadingSkeleton.jsx");
  const toasts = read("ToastSystem.jsx");

  // TabSet follows full WAI-ARIA tablist pattern
  assert.match(tabSet, /role="tablist"/);
  assert.match(tabSet, /role="tab"/);
  assert.match(tabSet, /aria-selected=\{selected\}/);
  assert.match(tabSet, /aria-controls=\{panelId\(group, tab\.value\)\}/);
  assert.match(tabSet, /tabIndex=\{selected \? 0 : -1\}/);
  assert.match(tabSet, /export function tabPanelProps\(group, value\) \{/);
  assert.match(tabSet, /role: "tabpanel", "aria-labelledby": tabId\(group, value\)/);

  // SegmentedChoice and FilterGroup share single radiogroup roving selection
  assert.match(segmented, /role="radiogroup"/);
  assert.match(segmented, /role="radio"/);
  assert.match(segmented, /aria-checked=\{isSelected\}/);
  assert.match(segmented, /function useRovingSelection/);
  assert.match(segmented, /export function SegmentedChoice/);
  assert.match(segmented, /export function FilterGroup/);

  // StatusChip supports semantic role alert/status
  assert.match(chip, /role=\{spec\.alert \? "alert" : "status"\}/);
  assert.match(chip, /export default function StatusChip/);

  // LoadingSkeleton provides accessible loading state
  assert.match(skeleton, /role="status"/);
  assert.match(skeleton, /aria-busy="true"/);
  assert.match(skeleton, /export function RegisterSkeleton/);

  // ToastSystem provides notification announcements
  assert.match(toasts, /className="mc-toast-container" aria-label="Notifications"/);
});

/* ---------------------------------------------------- T152 optical icon scaling */

test("T152 — icon sizes are clamped to the scale and stroke scales inversely with box size", () => {
  const app = read("App.jsx");

  // Four discrete steps
  assert.match(app, /const ICON_SIZES = \[12, 14, 16, 18\];/);

  // Optical compensation formula: smaller icon gets thicker stroke so stroke weight stays optically stable
  assert.match(app, /const step = ICON_SIZES\.reduce\(\(best, value\) => \(Math\.abs\(value - size\) < Math\.abs\(best - size\) \? value : best\), ICON_SIZES\[0\]\);/);
  assert.match(app, /const stroke = Math\.round\(\(1\.15 \* 24 \/ step\) \* 100\) \/ 100;/);
  assert.match(app, /<svg className="icon" width=\{step\} height=\{step\} viewBox="0 0 24 24"[^>]*strokeWidth=\{stroke\}/);
  assert.match(app, /aria-hidden="true" focusable="false"/);
});

/* -------------------------------------------------- T153 layout & radius tokens */

test("T153 — normalized radius scale, border hierarchy, and control heights are defined in tokens", () => {
  const bridge = tokens();
  const base = read(path.join("redesign", "base.css"));

  // Radius scale
  for (const radius of ["--mc-radius-2xs", "--mc-radius-xs", "--mc-radius-sm", "--mc-radius-md", "--mc-radius-lg", "--mc-radius-pill"]) {
    assert.ok(bridge.includes(`${radius}:`), `tokens-bridge missing ${radius}`);
  }

  // Border hierarchy
  for (const border of ["--mc-border:", "--mc-border-strong:", "--mc-border-faint:"]) {
    assert.ok(bridge.includes(border), `tokens-bridge missing ${border}`);
  }

  // Density control heights
  assert.match(base, /--mc-control-height: 30px;/);
  assert.match(base, /--mc-control-height: 32px;/);
  assert.match(base, /--mc-control-height: 36px;/);
  assert.match(base, /\.shell button \{ min-height: var\(--mc-control-height, 32px\); \}/);
});

/* ---------------------------------------------------- T164 monospace restriction */

test("T164 — monospace font is restricted to technical evidence and data, never body prose", () => {
  const bridge = tokens();
  const base = read(path.join("redesign", "base.css"));
  const surfacesCss = surfaces();

  // Monospace font token defined
  assert.match(bridge, /--mc-font-mono:\s*"JetBrains Mono Variable"/);

  // UI typography uses standard sans font, not monospace
  assert.match(bridge, /--font-family-ui:\s*"Inter Variable"/);
  assert.match(bridge, /--mc-font-ui:\s*var\(--font-family-ui\);/);
  assert.doesNotMatch(base, /body\s*\{[^}]*font-family:\s*var\(--mc-font-mono\)/);
  assert.doesNotMatch(surfacesCss, /\.shell\s*\{[^}]*font-family:\s*var\(--mc-font-mono\)/);
  assert.doesNotMatch(surfacesCss, /h[1-6]\s*\{[^}]*font-family:\s*var\(--mc-font-mono\)/);
});

/* ---------------------------------------------------- T162 & T163 visual direction */

test("T162 — operational collections as dense registers/rows, detail in inspectors, compact toolbars, zero fake charts", () => {
  const app = read("App.jsx");

  // Dense registers and rows
  assert.match(app, /mc-gs-register--operations/);
  assert.match(app, /ManifestList/);
  assert.match(app, /className="timeline"/);

  // Detail in inspectors rather than page bloat
  assert.match(app, /<WorkerInspector session=\{selected\}/);
  assert.match(app, /className=\{`context-inspector/);
  assert.match(app, /className="history-evidence"/);

  // Compact toolbars
  assert.match(app, /className="workspace-command-deck workspace-toolbar-v2"/);

  // No decorative charts, canvas meters, or fabricated telemetry widgets
  assert.doesNotMatch(app, /<canvas\b[^>]*\b(chart|gauge|telemetry)/i);
  assert.doesNotMatch(app, /className="[^"]*decorative-chart/i);
});

test("T163 — hierarchy from typography and spacing before borders, restrained semantic palette", () => {
  const base = read(path.join("redesign", "base.css"));
  const bridge = tokens();

  // Spacing scale is primary driver of layout
  for (const space of ["--mc-space-1", "--mc-space-2", "--mc-space-3", "--mc-space-4", "--mc-space-6", "--mc-space-8"]) {
    assert.ok(bridge.includes(`${space}:`), `missing space token ${space}`);
  }

  // Type scale hierarchy
  for (const step of ["--mc-text-xs", "--mc-text-sm", "--mc-text-base", "--mc-text-lg", "--mc-text-xl"]) {
    assert.ok(bridge.includes(`${step}:`), `missing type token ${step}`);
  }

  // Restrained semantic status roles (5 core states)
  const doc = fs.readFileSync(path.join(root, "MISSION_CONTROL_DESIGN_SYSTEM.md"), "utf8");
  assert.match(doc, /Five semantic roles, used identically everywhere a state is shown/);
});

test("T150 — CSS component families are structured vertically with scoped redesign layers", () => {
  const base = read(path.join("redesign", "base.css"));
  const cockpit = read(path.join("redesign", "cockpit.css"));
  const workspace = read(path.join("redesign", "workspace.css"));
  const surfacesCss = surfaces();

  // Component classes are scoped to .shell or view containers
  assert.match(surfacesCss, /\.mc-ref-groundstation/);
  assert.match(workspace, /\.workspace-experience/);
  assert.match(surfacesCss, /\.agent-operations/);
  assert.match(base, /\.shell/);
  assert.match(cockpit, /\.top-navigation__contextual/);
});

test("T198 — premiumDesign.css and premiumV3.css are bridged and overridden by the redesign layers", () => {
  const cockpit = read(path.join("redesign", "cockpit.css"));
  // premiumDesign.css variables re-sited on #root#root .shell to prevent dark palette freezing
  assert.match(cockpit, /#root#root \.shell \{\s+--theme-text-default: var\(--mc-text-soft\);/);
  assert.match(cockpit, /--surface-base: var\(--theme-canvas\);/);
  assert.match(cockpit, /--accent-primary: var\(--theme-accent\);/);
  assert.match(cockpit, /--accent-warning: var\(--mc-warning\);/);
  assert.match(cockpit, /--accent-danger: var\(--mc-danger\);/);
});



