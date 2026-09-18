"use strict";

// T013 — CSS baseline guard.
//
// MISSION_CONTROL_CSS_BASELINE.md records the stylesheet system before any
// consolidation work. These are ceilings, not exact matches: cleanup may lower
// every number here, but a regression that regrows the `!important` count, the
// raw-colour count, the file count, reintroduces `@import`, orphans a stylesheet,
// or reorders the cascade so the redesign layer no longer loads last must fail
// the build. Lower a ceiling here whenever cleanup lands so the ratchet holds.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const RENDERER = path.resolve(__dirname, "../src/groundstation/renderer");
const MAIN = path.join(RENDERER, "main.jsx");

const CEIL = {
  files: 22,
  important: 1417, // OUTARCH readiness passes: forced History chapters unwound, dead badge rule removed (was 1420)
  rawColors: 1198, // sidebar/toolbar polish: the two gradient tokens alias their stops, one AI violet added (was 1201)
};

function allCssFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allCssFiles(full));
    else if (entry.name.endsWith(".css")) out.push(full);
  }
  return out;
}

function importedCssOrder() {
  const main = fs.readFileSync(MAIN, "utf8");
  return [...main.matchAll(/["']\.\/([^"']+\.css)["']/g)].map(m => m[1]);
}

test("CSS file count is at or below the recorded baseline and nothing is orphaned", () => {
  const files = allCssFiles(RENDERER);
  assert.ok(files.length <= CEIL.files, `renderer has ${files.length} CSS files, baseline ceiling is ${CEIL.files}`);

  const imported = new Set(importedCssOrder().map(rel => path.basename(rel)));
  const orphans = files.map(f => path.basename(f)).filter(name => !imported.has(name));
  assert.deepEqual(orphans, [], `orphan stylesheet(s) not imported by main.jsx: ${orphans.join(", ")}`);
});

test("no renderer stylesheet uses @import", () => {
  for (const file of allCssFiles(RENDERER)) {
    const rel = path.relative(RENDERER, file).split(path.sep).join("/");
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /@import\b/, `${rel} contains an @import; the cascade order is main.jsx only`);
  }
});

test("!important and raw-colour totals stay at or below the recorded baseline", () => {
  let important = 0;
  let rawColors = 0;
  for (const file of allCssFiles(RENDERER)) {
    const source = fs.readFileSync(file, "utf8");
    important += (source.match(/!important/g) || []).length;
    rawColors += (source.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
    rawColors += (source.match(/\b(?:rgba?|hsla?)\(/g) || []).length;
  }
  assert.ok(important <= CEIL.important, `!important total is ${important}, baseline ceiling is ${CEIL.important}`);
  assert.ok(rawColors <= CEIL.rawColors, `raw colour total is ${rawColors}, baseline ceiling is ${CEIL.rawColors}`);
});

test("the redesign layer loads after styles.css and both premium stylesheets", () => {
  const order = importedCssOrder();
  const idx = name => order.findIndex(rel => rel === name || rel.endsWith(`/${name}`));

  const firstRedesign = order.findIndex(rel => rel.startsWith("redesign/"));
  assert.notEqual(firstRedesign, -1, "no redesign/ stylesheet is imported");
  for (const earlier of ["styles.css", "premiumDesign.css", "premiumV3.css"]) {
    const at = idx(earlier);
    assert.notEqual(at, -1, `${earlier} is not imported`);
    assert.ok(at < firstRedesign, `${earlier} must load before the redesign layer (found at ${at}, redesign starts at ${firstRedesign})`);
  }
  // redesign/surfaces.css resolves the shared primitives last of all.
  assert.equal(order.at(-1), "redesign/surfaces.css", "redesign/surfaces.css must be the final CSS import");
});

// T137/T144/T145 — theme correctness ratchet.
//
// A legacy rule that paints a literal near-black background is invisible in
// Orbital and a black slab in Solar Light and High contrast. Thirty of them
// were live at once. Any new one — or any redesign override that gets deleted
// — fails here, naming the class so the fix is obvious.
test("no live component surface hardcodes a dark background without a themed override", () => {
  const legacy = allCssFiles(RENDERER).filter(file => !file.includes(`${path.sep}redesign${path.sep}`));
  const redesign = allCssFiles(RENDERER)
    .filter(file => file.includes(`${path.sep}redesign${path.sep}`))
    .map(file => fs.readFileSync(file, "utf8"))
    .join("\n");
  const components = fs.readdirSync(RENDERER)
    .filter(name => name.endsWith(".jsx") || name.endsWith(".js"))
    .map(name => fs.readFileSync(path.join(RENDERER, name), "utf8"))
    .join("\n");

  // The terminal keeps its own palette on purpose; Settings says so in copy.
  const terminalOwned = /^(?:terminal-host|terminal-pane|terminal-grid|xterm)/;

  const offenders = [];
  for (const file of legacy) {
    const source = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of source.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const background = rule[2].match(/(?:^|;)\s*background(?:-color)?:\s*#([0-9a-fA-F]{3,8})/);
      if (!background) continue;
      const hex = background[1];
      const full = hex.length === 3 ? hex.split("").map(c => c + c).join("") : hex.slice(0, 6);
      const channels = [full.slice(0, 2), full.slice(2, 4), full.slice(4, 6)].map(part => parseInt(part, 16));
      if (channels.reduce((sum, part) => sum + part, 0) / 3 > 90) continue;
      for (const selector of rule[1].split(",")) {
        const match = selector.trim().match(/^\.([a-zA-Z0-9_-]+)$/);
        if (!match) continue;
        const name = match[1];
        if (terminalOwned.test(name)) continue;
        if (!components.includes(name)) continue;
        if (new RegExp(`\.${name}[^{}]*\{[^}]*background`).test(redesign)) continue;
        if (!offenders.includes(name)) offenders.push(name);
      }
    }
  }
  assert.deepEqual(offenders, [], `these live surfaces paint a dark background with no themed override, so they become black slabs in Solar and High contrast: ${offenders.join(", ")}`);
});
