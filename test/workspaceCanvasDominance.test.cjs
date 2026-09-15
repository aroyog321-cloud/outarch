"use strict";

// The Workspace route exists to show terminals, and before this pass it spent a
// third of the window not showing them: five stacked bands around the canvas,
// and two rows of chrome inside every pane. Measured at 1440x900 on a three-by-
// two canvas, a terminal showed seven rows of output.
//
// These tests lock the three things that fixed it and must not quietly regrow:
//
//   1. the density layer that made every band around the canvas one line;
//   2. focus mode — the whole frame collapses, every worker is mounted, and
//      exactly two controls remain, all of it presentation only;
//   3. the Mission Control browser — a real browser view inside the workspace,
//      held to the same loopback policy the Services panel already states.
//
// The cascade seams are locked as hard as the values are. Each of them exists
// so a later layer can retune a raised declaration without adding weight to a
// stylesheet budget that has none to give; deleting a seam looks harmless and
// silently restores the geometry it was added to escape.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createProtocolConnection } = require("../src/protocol/index.cjs");
const { LocalServiceRegistry } = require("../src/service/localServiceRegistry.cjs");
const { isLoopbackUrl, clampBounds } = require("../src/groundstation/main/workspaceBrowser.cjs");

const RENDERER = path.join(__dirname, "..", "src", "groundstation", "renderer");
const read = name => fs.readFileSync(path.join(RENDERER, name), "utf8");

function createMockEngineApi(sessions = [{ id: "worker-1", name: "Storefront", status: "running", isAlive: true }]) {
  return {
    subscribe: () => () => {},
    getState: () => ({ contractVersion: 1, sequence: 1 }),
    getActivity: () => ({ events: [] }),
    getWorkspace: () => ({}),
    listIntegrations: () => [],
    list: () => sessions,
    getSnapshot: id => sessions.find(session => session.id === id) || null,
    listSavedCommands: () => [],
    listMissions: () => [],
    listAttention: () => ({ records: [], preferences: {} }),
    listRecipes: () => [],
    listAutomations: () => ({ automations: [], audit: [] })
  };
}

// A stand-in for the WebContentsView owner. The view itself needs a real window,
// so what is exercised here is the protocol's side of the contract: which calls
// reach the browser, with what, and what a refusal looks like.
function createBrowserDouble() {
  const calls = [];
  const state = { available: true, open: false, url: "", title: "", loading: false, error: null, canGoBack: false, canGoForward: false };
  return {
    calls,
    open({ url, bounds } = {}) { calls.push(["open", url, bounds]); state.open = true; state.url = url || state.url; return { ...state }; },
    setBounds(bounds) { calls.push(["bounds", bounds]); return { ...state }; },
    command(action) { calls.push(["command", action]); return { ...state }; },
    close() { calls.push(["close"]); state.open = false; return { ...state }; },
    state() { return { ...state }; }
  };
}

/* ------------------------------------------------------------------ density */

test("every band around the terminal canvas is one line, and the pane spends one row on chrome", () => {
  const surfaces = read("redesign/surfaces.css");

  // The off-canvas roster was a bordered block with a wrapping chip list. It
  // keeps every entry and every click target; it stops being two rows.
  assert.match(surfaces, /\.workspace-background \{[\s\S]{0,320}?grid-template-columns: auto minmax\(0, 1fr\);/);
  assert.match(surfaces, /\.workspace-background ul \{[\s\S]{0,200}?flex-wrap: nowrap;[\s\S]{0,200}?overflow-x: auto;/);
  // A block-level kicker inside a bounded header wraps to three lines and makes
  // the row taller than the block it replaced.
  assert.match(surfaces, /\.workspace-background > header > \.section-kicker \{[\s\S]{0,120}?white-space: nowrap;/);

  // The pane identity stacked its name over its facts, which is what made the
  // header two rows tall in every pane on the canvas at once.
  assert.match(surfaces, /\.terminal-pane__identity > div \{\s*\n\s*display: flex !important;\s*\n\s*flex-direction: row;/,
    "restating display without the axis reactivates the legacy column direction");
  assert.match(surfaces, /\.terminal-pane__header \{\s*\n\s*min-height: 26px;/);
  // The activity readout stays: it is the only place the last reported line of
  // evidence appears. It stops being a second slab.
  assert.match(surfaces, /\.terminal-pane__activity \{\s*\n\s*min-height: 18px;/);
});

test("the raised geometry the density layer lowers is reachable through properties, not new weight", () => {
  const premium = read("premiumDesign.css");
  const base = read("redesign/base.css");
  const cockpit = read("redesign/cockpit.css");
  const workspace = read("redesign/workspace.css");
  const surfaces = read("redesign/surfaces.css");

  // premiumDesign states the deck control height and the pane header floor with
  // raised weight. Both now read a property whose fallback is the old value, so
  // the legacy sheet is unchanged on its own and a later layer can retune it.
  assert.match(premium, /\.workspace-actions button \{ min-height: var\(--mc-deck-control-h, 30px\) !important;/);
  assert.match(premium, /\.terminal-pane__header \{ position: relative; min-height: var\(--terminal-head-h, 38px\) !important;/);
  assert.match(surfaces, /--mc-deck-control-h: 26px;/);
  assert.match(surfaces, /--terminal-head-h: 26px;/);

  // The shell frame: sidebar width and status-bar row, so focus mode can retire
  // both without outbidding the base layer's own raised declarations.
  assert.match(base, /grid-template-columns: var\(--mc-rail-w, 212px\) minmax\(0, 1fr\) !important;/);
  assert.match(base, /width: var\(--mc-rail-w, 212px\) !important;/);
  assert.match(base, /grid-template-rows: var\(--mc-topbar-h, 42px\) minmax\(0, 1fr\) !important;/);

  // The canvas templates, so the mosaic is a retune of the canvas rather than a
  // competing set of rules. Every layout must route through the same property.
  for (const layout of ["layout-single", "layout-horizontal", "layout-vertical", "layout-grid-2x2", "layout-grid-3x2"]) {
    const at = workspace.indexOf(`.terminal-grid.${layout}`);
    assert.ok(at > -1, `${layout} has no geometry rule`);
  }
  assert.match(workspace, /overflow: var\(--mc-canvas-overflow, hidden\) !important;/);
  // Counting the routed rules would not catch the failure that matters: a
  // single rule left stating a template directly wins on order and the mosaic
  // silently stops packing. So every canvas-template declaration in the file is
  // checked, not a count of the ones that were remembered.
  for (const [, selector, body] of workspace.matchAll(/([^};{]*\.terminal-grid[^{]*)\{([^}]*)\}/g)) {
    for (const [, property, value] of body.matchAll(/(grid-template-(?:columns|rows)):([^;]*);/g)) {
      const routed = value.includes(property === "grid-template-columns" ? "--mc-canvas-cols" : "--mc-canvas-rows");
      // A narrow-width fallback is allowed to state a template outright, but
      // only if it excludes the mosaic by selector — the mosaic packs itself and
      // must keep doing so at every width.
      // `.has-expanded` is the accordion, which the mosaic guard in App.jsx
      // already excludes: a mosaic requires no expanded pane, so the two modes
      // never describe the same canvas.
      const excluded = selector.includes(":not(.is-mosaic)") || selector.includes(".has-expanded");
      assert.ok(routed || excluded, `a canvas rule states ${property} directly and would beat the mosaic: ${selector.trim()}`);
    }
  }

  // The two deck regions focus mode retires.
  assert.match(cockpit, /\.workspace-title \{\s*\n\s*display: var\(--mc-deck-aside, flex\) !important;/);
  assert.match(cockpit, /\.workspace-toolbar-group \{\s*\n\s*display: var\(--mc-deck-aside, flex\) !important;/);
  assert.match(workspace, /\.workspace-experience\.is-focus-mode \{ --mc-deck-aside: none; \}/);
});

/* --------------------------------------------------------------- focus mode */

test("focus mode collapses the whole frame, not just this route", () => {
  const app = read("App.jsx");
  const surfaces = read("redesign/surfaces.css");

  // The sidebar and the status bar are rendered by the shell, so the mode has
  // to reach past the route. It is mirrored onto the document element, and
  // cleaned up on unmount so leaving the route cannot strand the frame.
  assert.match(app, /root\.dataset\.workspaceFocus = "on"/);
  assert.match(app, /return \(\) => \{ delete root\.dataset\.workspaceFocus; \};/);
  assert.match(surfaces, /:root\[data-workspace-focus="on"\][\s\S]{0,120}?--mc-rail-w: 0px;/);
  // The native window controls stay on screen, so the top strip keeps exactly
  // their height (zero when there is no overlay) and is the drag region.
  assert.match(surfaces, /:root\[data-workspace-focus="on"\][\s\S]{0,160}?--mc-topbar-h: env\(titlebar-area-height, 0px\);/);
  assert.match(surfaces, /:root\[data-workspace-focus="on"\] #root#root#root \.shell > \.main-area::before \{[^}]*-webkit-app-region: drag;/);
  assert.match(app, /window\.missionControl\?\.setWindowChrome\?\.\(mode\)/);
  const main = fs.readFileSync(path.resolve(__dirname, "../src/groundstation/main/index.cjs"), "utf8");
  assert.match(main, /ipcMain\.handle\("mission-control:set-window-chrome"[\s\S]{0,200}assertTrustedMainFrame\(event\);/);
  assert.match(main, /if \(mode !== "standard" && mode !== "focus"\) throw/);
  assert.match(surfaces, /:root\[data-workspace-focus="on"\][\s\S]{0,400}?\.mission-status-bar \{ display: none; \}/);

  // The orientation aids that earn their place on a canvas you scan are noise
  // on the canvas you are reading.
  assert.match(surfaces, /:root\[data-workspace-focus="on"\][\s\S]{0,400}?\.worker-metric-strip,/);
  assert.match(surfaces, /:root\[data-workspace-focus="on"\][\s\S]{0,400}?\.terminal-role-tag,/);
});

test("focus mode leaves exactly two controls, floating rather than banded", () => {
  const workspace = read("redesign/workspace.css");

  // Reserving a band would put the chrome back that focus mode exists to remove.
  assert.match(workspace, /\.is-focus-mode \.workspace-toolbar-v2 \{[\s\S]{0,220}?position: absolute;/);
  // Adding a worker, asking the assistant and leaving are the answers focus
  // mode does not already give, so they are the controls that survive. The
  // assistant joined on 2026-09-12: it is a tile on the mosaic and has to be
  // reachable from the mode that shows every tile. The notifications bell
  // joined on 2026-09-14: focus mode hides every other place a notification
  // can be found again once its toast is dismissed.
  assert.match(
    workspace,
    /\.is-focus-mode \.workspace-actions > :not\(\.workspace-add-worker\):not\(\.workspace-assistant-toggle\):not\(\.workspace-notifications\):not\(\.workspace-focus-mode\) \{ display: none; \}/
  );
});

test("focus mode is presentation only and reachable from the keyboard", () => {
  const app = read("App.jsx");

  // Alt is the workspace modifier throughout the app, so focus mode joins it
  // rather than claiming a bare key a terminal would swallow.
  const handler = app.slice(app.indexOf("if (!event.altKey || event.ctrlKey || event.metaKey) return;"));
  assert.match(handler, /String\(event\.key\)\.toLowerCase\(\) !== "f"/);
  assert.match(handler, /document\.querySelector\("\[role='dialog'\],\[role='alertdialog'\]"\)/,
    "a dialog owns the keyboard while it is open");
  assert.match(app, /setFocusMode\(value => !value\)/);

  // Toggling the mode must never dispatch a worker action: what is on screen
  // changes, what the engine is doing does not.
  const view = app.slice(app.indexOf("function WorkspaceView("), app.indexOf("const AGENT_DECISION_SOURCES"));
  const toggles = view.split("setFocusMode(");
  for (const fragment of toggles.slice(1)) {
    assert.doesNotMatch(fragment.slice(0, 120), /onAction|dispatch|terminal\.(open|close|write)/);
  }
});

/* -------------------------------------------------------------- the mosaic */

test("focus mode mounts every supervised worker, not the slots a layout has room for", () => {
  const app = read("App.jsx");

  assert.match(app, /const mosaic = focusMode && !activeFolder && !expandedId && sessions\.length > 0;/);
  assert.match(app, /const canvasWorkers = mosaic \? sessions : visible;/);
  // An expanded pane and a folder selection are narrowings the operator just
  // asked for; the mosaic must not undo either.
  assert.match(app, /const mosaic = focusMode && !activeFolder && !expandedId/);

  // The column count is derived from the worker count, and handed to CSS as the
  // tile's minimum width so a narrow window falls back to fewer, wider columns.
  assert.match(app, /const mosaicColumns = packedCanvas[\s\S]{0,200}?Math\.sqrt\(tileCount \/ 2\.4\)/);
  assert.match(app, /"--mosaic-cols": mosaicColumns/);

  // The mosaic resizes per terminal, the same as the slot layouts.
  assert.match(app, /const canvasTileCount = packedCanvas \? tileCount : canvasWorkers\.length;/);

  const surfaces = read("redesign/surfaces.css");
  assert.match(surfaces, /\.terminal-grid\.is-mosaic \{[\s\S]{0,400}?--mc-canvas-cols: repeat\(auto-fit, minmax\(max\(var\(--pane-min-w\)/);
  assert.match(surfaces, /\.terminal-grid\.is-mosaic \{[\s\S]{0,400}?--mc-canvas-overflow: auto;/,
    "a mosaic too large for the window scrolls rather than shrinking tiles below the readable floor");
});

/* ------------------------------------------------- Mission Control browser */

test("the browser view previews only addresses on this machine", () => {
  for (const allowed of [
    "http://localhost:5173",
    "http://127.0.0.1:8080/health",
    "https://localhost:3000",
    "http://[::1]:4000"
  ]) assert.equal(isLoopbackUrl(allowed), true, `${allowed} should be previewable`);

  for (const refused of [
    "https://example.com",
    "http://192.168.1.10:8080",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://user:secret@localhost:3000",
    "not a url",
    ""
  ]) assert.equal(isLoopbackUrl(refused), false, `${refused} must not be previewable`);
});

test("a reported rectangle cannot park the browser view outside or across the window", () => {
  const content = { width: 1440, height: 900 };

  const normal = clampBounds({ x: 100, y: 200, width: 400, height: 300 }, content);
  assert.deepEqual(normal, { x: 100, y: 200, width: 400, height: 300 });

  // A stale rectangle from a previous layout must be brought back inside.
  const overflowing = clampBounds({ x: 1200, y: 800, width: 900, height: 900 }, content);
  assert.ok(overflowing.x + overflowing.width <= content.width);
  assert.ok(overflowing.y + overflowing.height <= content.height);

  // Negative origins are clamped rather than trusted.
  const negative = clampBounds({ x: -500, y: -500, width: 400, height: 300 }, content);
  assert.deepEqual(negative, { x: 0, y: 0, width: 400, height: 300 });

  // Nonsense and collapsed rectangles are refused outright, which leaves the
  // view where it was rather than moving it somewhere wrong.
  for (const bad of [null, {}, { x: 0, y: 0, width: 10, height: 10 }, { x: NaN, y: 0, width: 400, height: 300 }]) {
    assert.equal(clampBounds(bad, content), null);
  }
});

test("the protocol exposes the browser and refuses a non-local address", async () => {
  const browser = createBrowserDouble();
  const connection = createProtocolConnection(createMockEngineApi(), { send: () => {}, workspaceBrowser: browser });

  const opened = await connection.handle({ version: 1, id: "b-1", method: "workspace.browser.open", params: { url: "http://localhost:5173/app" } });
  assert.equal(opened.ok, true);
  assert.equal(opened.result.open, true);
  assert.deepEqual(browser.calls.at(-1).slice(0, 2), ["open", "http://localhost:5173/app"]);

  const remote = await connection.handle({ version: 1, id: "b-2", method: "workspace.browser.open", params: { url: "https://example.com" } });
  assert.equal(remote.ok, false);
  assert.equal(remote.error.code, "FORBIDDEN");

  // A service record drops the query it was printed with, because a worker's
  // log can carry a token. An address the operator typed is not that, and
  // loading a different page than the one asked for is worse than refusing.
  const withQuery = await connection.handle({
    version: 1, id: "b-2b", method: "workspace.browser.open",
    params: { url: "http://localhost:5173/app?tab=settings#panel" }
  });
  assert.equal(withQuery.ok, true);
  assert.equal(browser.calls.at(-1)[1], "http://localhost:5173/app?tab=settings#panel");

  const credentials = await connection.handle({
    version: 1, id: "b-2c", method: "workspace.browser.open",
    params: { url: "http://user:secret@localhost:5173" }
  });
  assert.equal(credentials.ok, false);
  assert.equal(credentials.error.code, "FORBIDDEN");

  const unknown = await connection.handle({ version: 1, id: "b-3", method: "workspace.browser.command", params: { action: "evaluate" } });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "INVALID_PARAMS");

  const back = await connection.handle({ version: 1, id: "b-4", method: "workspace.browser.command", params: { action: "back" } });
  assert.equal(back.ok, true);
  assert.deepEqual(browser.calls.at(-1), ["command", "back"]);

  connection.dispose();
});

test("a service a worker advertised opens in the workspace, and the system browser stays one choice away", async () => {
  const registry = new LocalServiceRegistry();
  registry.recordOutput("worker-1", "run-1", "Local: http://localhost:5173/");
  const [service] = registry.listServices();
  const browser = createBrowserDouble();
  const external = [];

  const connection = createProtocolConnection(createMockEngineApi(), {
    send: () => {},
    localServiceRegistry: registry,
    workspaceBrowser: browser,
    openServiceUrl: async url => external.push(url)
  });

  // Following a worker's own address should not cost the operator the window
  // they are working in, so the workspace browser is where it lands.
  const inApp = await connection.handle({ version: 1, id: "s-1", method: "services.open", params: { serviceId: service.id } });
  assert.equal(inApp.ok, true);
  assert.equal(inApp.result.target, "workspace");
  assert.deepEqual(external, [], "the default must not leave the application");
  assert.deepEqual(browser.calls.at(-1).slice(0, 2), ["open", "http://localhost:5173"]);

  // And the operating system is still reachable, explicitly.
  const outside = await connection.handle({ version: 1, id: "s-2", method: "services.open", params: { serviceId: service.id, external: true } });
  assert.equal(outside.ok, true);
  assert.equal(outside.result.target, "system");
  assert.deepEqual(external, ["http://localhost:5173"]);

  connection.dispose();
});

test("the browser tile keeps the main process told where it is, and yields to anything that must be above it", () => {
  const tile = read("WorkspaceBrowser.jsx");

  // The page is a native view, so the component reserves a rectangle and
  // reports it rather than rendering anything into it.
  assert.match(tile, /className="workspace-browser__viewport" ref=\{viewportRef\}/);
  assert.match(tile, /new ResizeObserver\(schedule\)/);
  assert.match(tile, /window\.addEventListener\("resize", schedule\)/);
  assert.match(tile, /request\("workspace\.browser\.bounds"/);

  // A native view does not stack with the DOM: menus, popovers and dialogs
  // would all render behind it. Radix wraps every one of them in the same
  // positioning element, so one selector covers the family.
  assert.match(tile, /\[data-radix-popper-content-wrapper\]/);
  assert.match(tile, /hidden: overlayOpen \|\| covered \|\| rect\.width < 2 \|\| rect\.height < 2/);

  // Notifications are not overlays — they trap no focus and block nothing,
  // which is why they stopped claiming a dialog role on 2026-09-12. They do
  // still paint in DOM, so the view yields to one only while it is actually
  // on top of the tile: a stack in a corner the browser is not in costs the
  // browser nothing, and a persistent failure toast no longer blanks a page
  // it never touched.
  assert.match(tile, /document\.querySelectorAll\("\.mc-toast"\)\].some\(toast => \{/);
  assert.match(tile, /box\.left < rect\.right && box\.right > rect\.left/);
  assert.doesNotMatch(read("ToastSystem.jsx"), /"alertdialog"/,
    "a toast that claims a dialog role makes every dialog-aware surface step aside for it");

  // Unmounting for any reason has to take the view with it, or a page stays
  // painted over a screen that no longer reserves room for it.
  assert.match(tile, /React\.useEffect\(\(\) => \(\) => \{\s*\n\s*void missionApi\(\)\.request\("workspace\.browser\.command", \{ action: "close" \}\)/);

  // Focus mode floats its controls over the canvas, which a native view would
  // paint straight over, so the canvas gives them a strip of their own.
  const surfaces = read("redesign/surfaces.css");
  assert.match(surfaces, /\.is-focus-mode \.terminal-grid\.has-browser \{ margin-bottom: 44px; \}/);
});

test("the previewed page is given nothing the renderer has", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "groundstation", "main", "workspaceBrowser.cjs"), "utf8");

  // No preload, no Node, its own session partition.
  assert.doesNotMatch(source, /preload:/, "a preview page must not be handed a preload script");
  assert.match(source, /sandbox: true/);
  assert.match(source, /contextIsolation: true/);
  assert.match(source, /nodeIntegration: false/);
  assert.match(source, /webviewTag: false/);
  assert.match(source, /partition: PARTITION/);

  // The policy is re-checked at every navigation, so a page cannot walk off the
  // machine even if a caller upstream were wrong.
  assert.match(source, /contents\.on\("will-navigate"[\s\S]{0,160}?event\.preventDefault\(\)/);
  assert.match(source, /contents\.on\("will-redirect"[\s\S]{0,160}?event\.preventDefault\(\)/);
  assert.match(source, /setWindowOpenHandler/);
  assert.match(source, /return \{ action: "deny" \};/);
  assert.match(source, /setPermissionRequestHandler\(\(_contents, _permission, callback\) => callback\(false\)\)/);

  // The main window's own refusal to attach a webview is what this design
  // exists to preserve; it must still be there.
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "groundstation", "main", "index.cjs"), "utf8");
  assert.match(main, /will-attach-webview", event => event\.preventDefault\(\)/);
  // The view is a child of the window, so it is torn down with it.
  assert.match(main, /workspaceBrowser\?\.dispose\(\);/);
  assert.match(main, /workspaceBrowser\?\.close\(\);/);
});

test("focus mode keeps notifications reachable, and a service notification carries every answer", () => {
  const app = read("App.jsx");
  const toasts = read("ToastSystem.jsx");
  const tray = read("NotificationTray.jsx");
  const status = read("StatusBar.jsx");
  const workspaceCss = fs.readFileSync(path.join(RENDERER, "redesign", "workspace.css"), "utf8");
  const has = (source, text, message) => assert.ok(source.includes(text), message || `missing: ${text}`);
  // Every in-app notice comes from the notification center, one subscription.
  has(app, 'message?.type !== "notification:new"');
  assert.ok(!app.includes('message?.type === "workspace:event" ? message.event'), "the old per-event toasts are gone");
  // Each action a notice can carry does what it says.
  has(app, 'if (actionId === "open-service") return void openService(data.serviceId, data.generation);');
  has(app, 'if (actionId === "copy-url") return void copyService(data.serviceId, data.generation);');
  has(app, 'if (actionId === "restart" && notice.workerId) return void dispatchRef.current("restart", notice.workerId);');
  has(app, 'if (actionId === "stop" && notice.workerId) return void dispatchRef.current("kill", notice.workerId);');
  // A port conflict can say who holds the port, through the read-only inspector.
  has(app, 'request("crashlens.port.inspect", { port })');
  // The center decides whether it rings; the app rings only when Windows is not.
  has(app, 'sound: delivery.soundBy === "app" ? delivery.sound : null');
  // Toasts take several actions, and what mattered stays reviewable after it is dismissed.
  has(toasts, "function actionsOf(options)");
  has(toasts, "export function useNotificationHistory()");
  // The list is reachable from the tape on every screen, and from the focus deck.
  has(status, '<NotificationTray variant="tape" needsCount={pendingCount} onReviewNeeds={onReviewNeeds}/>');
  has(app, "{focusMode && <NotificationTray needsCount={needsCount} onReviewNeeds={onReviewNeeds}/>}");
  has(workspaceCss, ":not(.workspace-notifications)");
  has(tray, 'aria-label={badge ? `Notifications, ${badge} new` : "Notifications"}');
});
