"use strict";

// Phase 5 - Settings information architecture (T120, T121, T122).
//
// T120 - eight groups, each a place rather than a heading in one long scroll.
// T121 - implementation-library links are developer documentation; they live in
//        About, not in the column that holds theme and font size.
// T122 - engine-contract and recovery-controller facts are Diagnostics. They
//        change nothing, and sitting them beside Theme invited a reader to look
//        for a control that does not, and should not, exist.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const rendererRoot = path.join(__dirname, "..", "src", "groundstation", "renderer");
const read = (...parts) => fs.readFileSync(path.join(rendererRoot, ...parts), "utf8");

function block(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} is missing`);
  return source.slice(start, source.indexOf("\nfunction ", start + 1));
}

test("T120 - the groups exist, in the documented order, with the account first", () => {
  const app = read("App.jsx");
  const groups = app.slice(app.indexOf("const SETTINGS_GROUPS = ["), app.indexOf("const SETTINGS_GROUP_KEY"));
  const ids = [...groups.matchAll(/\["([a-z]+)", "/g)].map(match => match[1]);
  assert.deepEqual(ids, [
    "account",
    "appearance",
    "terminal",
    "notifications",
    "project",
    "integrations",
    "security",
    "diagnostics",
    "about"
  ]);

  // Each id resolves to exactly one panel, and Integrations navigates to the
  // route that owns it rather than growing a second copy here (T249).
  const hub = block(app, "SettingsHub");
  for (const [id, component] of [
    ["account", "AccountSettings"],
    ["appearance", "SettingsView"],
    ["terminal", "TerminalSettings"],
    ["notifications", "NotificationSettings"],
    ["project", "ProjectDefaultSettings"],
    ["security", "SecuritySettings"],
    ["diagnostics", "DiagnosticsSettings"],
    ["about", "AboutSettings"]
  ]) {
    assert.ok(hub.includes(`group === "${id}" && <${component}`), `${id} does not render ${component}`);
  }
  assert.match(hub, /id === "integrations" \? onOpenIntegrations\(\) : select\(id\)/);
  assert.doesNotMatch(hub, /group === "integrations" && </, "Integrations is a route, not a panel");

  // The chosen group survives a restart, and an unknown stored value falls back
  // rather than rendering nothing.
  assert.match(hub, /SETTINGS_GROUPS\.some\(\(\[id\]\) => id === stored\) \? stored : "appearance"/);
});

test("T120 - Restore defaults stays with the preferences it actually resets", () => {
  const app = read("App.jsx");
  const hub = block(app, "SettingsHub");
  assert.match(hub, /\(group === "appearance" \|\| group === "terminal"\) && <SettingsResetFooter/);
  // Its scope preview is unchanged; it must not appear over groups it cannot change.
  assert.doesNotMatch(hub, /group === "diagnostics"[\s\S]{0,80}SettingsResetFooter/);
});

test("T122 - engine and recovery facts moved out of the preference column into Diagnostics", () => {
  const app = read("App.jsx");
  const appearance = block(app, "SettingsView");
  const diagnostics = block(app, "DiagnosticsSettings");

  // Gone from the preferences panel.
  assert.doesNotMatch(appearance, /Engine contract|Recovery controller|Workspace mode|Operational facts/);
  // Present, with the reason recorded, in Diagnostics.
  assert.match(diagnostics, /Engine contract/);
  assert.match(diagnostics, /Recovery controller/);
  assert.match(diagnostics, /Workspace mode/);
  assert.match(diagnostics, /Nothing here is a setting\./);
  // Diagnostics reports; it must not offer a control that mutates anything.
  assert.doesNotMatch(diagnostics, /onPreference|missionApi\(\)\.request|onReset/);
});

test("T121 - implementation-library links live in About, not in the preferences column", () => {
  const app = read("App.jsx");
  const about = block(app, "AboutSettings");
  assert.match(about, /<ResourceLinks\/>/);

  // Exactly one place renders them.
  assert.equal((app.match(/<ResourceLinks\/>/g) || []).length, 1);
  const appearance = block(app, "SettingsView");
  assert.doesNotMatch(appearance, /ResourceLinks|radix-ui\/primitives|cmdk/);

  // They are no longer a top-level settings panel competing with real settings.
  const resourceLinks = block(app, "ResourceLinks");
  assert.doesNotMatch(resourceLinks, /className="settings-panel settings-resources"/);
  assert.match(resourceLinks, /className="settings-resources-inline"/);
  assert.match(resourceLinks, /Implementation references/);
});

test("T120 - the new groups report facts and route elsewhere to change them", () => {
  const app = read("App.jsx");
  const project = block(app, "ProjectDefaultSettings");
  const security = block(app, "SecuritySettings");

  // Project defaults reads engine state and sends the operator to the one place
  // a worker is actually configured.
  assert.match(project, /sessions\.filter\(session => session\.autoStart\)\.length/);
  assert.match(project, /onNavigate\("workspace"\)/);
  assert.doesNotMatch(project, /onPreference/, "a second place to edit a worker would be free to disagree with the first");

  // Security states behaviour, and every line is something the code keeps.
  assert.match(security, /Never sent to a model or an export/);
  assert.match(security, /OS-encrypted; never written to project files/);
  assert.match(security, /workspace\?\.persistent \? "Stored in this project folder" : "Held in memory only"/);
});
