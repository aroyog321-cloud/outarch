"use strict";

// OUTARCH identity: the product name and the brand files every surface
// shares. The images are built by scripts/brand/build-brand-assets.py from the
// sources in assets/brand/source/.

const path = require("node:path");

const PRODUCT_NAME = "OUTARCH";
const PRODUCT_SLUG = "outarch";
const PRODUCT_TAGLINE = "Developer cockpit";
// Windows groups taskbar buttons and attributes toasts by this id.
const APP_USER_MODEL_ID = "OUTARCH.Desktop";

const BRAND_DIRECTORY = __dirname;
const brandFile = name => path.join(BRAND_DIRECTORY, name);

const ASSETS = Object.freeze({
  // Windows reads every size it needs from the .ico; other platforms take the PNG.
  windowIcon: process.platform === "win32" ? brandFile("outarch.ico") : brandFile("outarch.png"),
  iconPng: brandFile("outarch.png"),
  iconPng256: brandFile("outarch-256.png"),
  iconPng128: brandFile("outarch-128.png"),
  pwaIcon192: brandFile("outarch-pwa-192.png"),
  pwaIcon512: brandFile("outarch-pwa-512.png"),
  touchIcon180: brandFile("outarch-touch-180.png")
});

module.exports = {
  APP_USER_MODEL_ID,
  ASSETS,
  PRODUCT_NAME,
  PRODUCT_SLUG,
  PRODUCT_TAGLINE
};
