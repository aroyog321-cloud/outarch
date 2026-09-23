"use strict";

// Copies OUTARCH's policy text from the desktop renderer to the website, so the
// app and the site always show the same words. The website is deployed from
// its own repository and cannot import from the desktop tree, so it keeps a
// copy; test/legalPolicies.test.cjs fails if the copy drifts.
//
//   node scripts/sync-legal.cjs          write the website copy
//   node scripts/sync-legal.cjs --check  exit 1 if the copy differs

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "src", "groundstation", "renderer", "legal", "outarchPolicies.js");
const target = path.join(root, "website", "src", "legal", "outarchPolicies.js");

const text = fs.readFileSync(source, "utf8");
const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;

if (process.argv.includes("--check")) {
  if (current !== text) {
    console.error("website/src/legal/outarchPolicies.js is out of date. Run: node scripts/sync-legal.cjs");
    process.exit(1);
  }
  console.log("Website policies match the desktop app.");
} else if (current === text) {
  console.log("Website policies already match the desktop app.");
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, "utf8");
  console.log(`Wrote ${path.relative(root, target)}`);
}
