import React from "react";
import markUrl from "./brand/outarch-mark.svg";
import wordmarkUrl from "./brand/outarch-wordmark-sm.svg";
import wordmarkLargeUrl from "./brand/outarch-wordmark.svg";

// OUTARCH's logo in the renderer. The marks are vectors drawn by
// scripts/brand/build-vector-marks.cjs from the brand sources' letterforms:
// the source bitmaps' glitch slices and colour fringes turn into noise at the
// 20-34px the app shows its logo at, and a vector stays sharp at every scale
// and display density. The wordmark is light ink on a transparent ground, so
// it belongs on the app's dark surfaces only. The small wordmark keeps only
// the blue ghost; the large one (the boot screen) carries the glitch detail.

export const PRODUCT_NAME = "OUTARCH";
// Stamped in at build time from package.json (vite.groundstation.config.mjs).
export const PRODUCT_VERSION = typeof __OUTARCH_VERSION__ === "string" ? __OUTARCH_VERSION__ : "";

// The app icon: the glitch O on its rounded black tile. Decorative by default,
// because every place it appears already names the app or the action. One
// vector serves every size, so `large` only names the larger placements.
export function BrandIcon({ large = false, label = "", className = "" }) {
  return <img
    className={`brand-icon${large ? " is-large" : ""} ${className}`.trim()}
    src={markUrl}
    alt={label}
    aria-hidden={label ? undefined : "true"}
    draggable="false"
  />;
}

// The wordmark. It is the product name, so it always carries it as text.
export function BrandWordmark({ large = false, className = "" }) {
  return <img
    className={`brand-wordmark ${className}`.trim()}
    src={large ? wordmarkLargeUrl : wordmarkUrl}
    alt={PRODUCT_NAME}
    draggable="false"
  />;
}
