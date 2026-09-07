"use strict";

// T249 — Duplicated capability entry points, pinned.
//
// MISSION_CONTROL_ENTRY_POINT_INVENTORY.md is the finding. The one real problem is
// that "Recipes" resolves to two destinations (the route vs. the builder dialog)
// depending on the surface. This test records the current wiring so the
// recommended consolidation is a visible, intentional diff — and so a *third*
// divergent "Recipes" behaviour can't slip in unnoticed.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const app = fs.readFileSync(path.resolve(__dirname, "../src/groundstation/renderer/App.jsx"), "utf8");

test("single-destination capabilities stay single-destination", () => {
  // Add worker — every entry point opens the one create dialog.
  const addWorker = [...app.matchAll(/setWorkerDialog\(\{ mode: "create" \}\)/g)].length;
  assert.ok(addWorker >= 3, `expected the create-dialog handler at multiple entry points, found ${addWorker}`);

  // Mission Graph — every entry point opens the one modal, none navigate.
  const openGraph = [...app.matchAll(/setMissionGraphOpen\(true\)/g)].length;
  assert.ok(openGraph >= 2, `expected Mission Graph to open the same modal from multiple surfaces, found ${openGraph}`);
  assert.doesNotMatch(app, /setView\("mission-graph"\)/); // it is a modal, never a route
});

test("T084 — Recipes has one destination: the route, with the builder on top of it", () => {
  // Route destination: it is a first-class route, reached by sidebar + palette.
  assert.match(app, /\["recipes", "Recipes", "grid"\]/);          // NAVIGATION entry → sidebar + palette "Navigate" group
  assert.match(app, /label: "Open workspace recipes"[\s\S]{0,160}setView\("recipes"\)/); // palette workspace-action item

  // Generic "Recipes" affordances navigate. They no longer open a bare create
  // dialog from a view that then had nowhere sensible to return to.
  assert.match(app, /const goToRecipes = React\.useCallback\(\(\) => setView\("recipes"\), \[\]\);/);
  const openBuilderFromView = [...app.matchAll(/onRecipes=\{\(\) => openRecipeBuilder\(\)\}/g)].length;
  assert.equal(openBuilderFromView, 0, "no view may bind a generic Recipes control straight to the builder");

  // The builder always lands on the route first, so dismissing it leaves the
  // operator where the recipes actually are.
  const builder = app.slice(app.indexOf("const openRecipeBuilder = React.useCallback"), app.indexOf("const goToRecipes"));
  assert.match(builder, /setView\("recipes"\);/);
  assert.match(builder, /setRecipesOpen\(\{ mode:/);
  assert.ok(
    builder.indexOf('setView("recipes")') < builder.indexOf("setRecipesOpen("),
    "the route must be selected before the dialog opens over it"
  );

  // An explicitly creational control still opens the builder directly.
  assert.match(app, /onCreateRecipe=\{\(\) => openRecipeBuilder\(\)\}/);
  assert.match(app, /<GroundstationOnboarding onAddWorker=\{onAddWorker\} onRecipes=\{onCreateRecipe\}\/>/);

  // The explicit create/edit entry inside the route is correct — keep it.
  assert.match(app, /<RecipesView sessions=\{sessions\} onManage=\{openRecipeBuilder\}/);
});
