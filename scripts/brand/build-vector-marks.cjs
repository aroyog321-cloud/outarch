#!/usr/bin/env node
"use strict";

// Vector OUTARCH marks for the renderer.
//
//   node scripts/brand/build-vector-marks.cjs
//
// The brand sources are compressed bitmaps. Their glitch slices and colour
// fringes are fine at poster size and turn into noise at the 20-34px the app
// shows its logo at, so the renderer draws the same letterforms as vectors:
// heavy, squared, narrow counters, the blue ghost behind the white, and the
// glitch bars only where there is room for them to read.
//
// The bitmap icons (window, taskbar, installer, PWA) still come from
// build-brand-assets.py.

const fs = require("node:fs");
const path = require("node:path");

const OUT = path.resolve(__dirname, "../../src/groundstation/renderer/brand");

const WHITE = "#f6f8fc";
const BLUE = "#2f7bff";
const TEAL = "#3fd0b5";

// Cap height is 100 units; each glyph is drawn from its own left edge.
const GLYPHS = [
  { width: 64, d: "M22 0H42A22 22 0 0 1 64 22V78A22 22 0 0 1 42 100H22A22 22 0 0 1 0 78V22A22 22 0 0 1 22 0Z M31 24A5 5 0 0 0 26 29V71A5 5 0 0 0 31 76H33A5 5 0 0 0 38 71V29A5 5 0 0 0 33 24Z" },
  { width: 62, d: "M0 0H26V71A5 5 0 0 0 31 76A5 5 0 0 0 36 71V0H62V78A22 22 0 0 1 40 100H22A22 22 0 0 1 0 78Z" },
  { width: 60, d: "M0 0H60V24H43V100H17V24H0Z" },
  { width: 68, d: "M18 0H50L68 100H42L39.6 84H28.4L26 100H0Z M32 28L29.5 62H38.5L36 28Z" },
  { width: 62, d: "M0 0H40A22 22 0 0 1 62 22V36A22 22 0 0 1 43.8 57.7L62 100H36L26 62V100H0Z M26 22V38H34A4 4 0 0 0 38 34V26A4 4 0 0 0 34 22Z" },
  { width: 60, d: "M22 0H38A22 22 0 0 1 60 22V36H34V28A4 4 0 0 0 30 24A4 4 0 0 0 26 28V72A4 4 0 0 0 30 76A4 4 0 0 0 34 72V64H60V78A22 22 0 0 1 38 100H22A22 22 0 0 1 0 78V22A22 22 0 0 1 22 0Z" },
  { width: 62, d: "M0 0H26V38H36V0H62V100H36V62H26V100H0Z" }
];
const TRACKING = 8;

function word() {
  let x = 0;
  const parts = GLYPHS.map(glyph => {
    const part = `<path transform="translate(${x} 0)" d="${glyph.d}"/>`;
    x += glyph.width + TRACKING;
    return part;
  });
  return { markup: parts.join(""), width: x - TRACKING };
}

const svg = (viewBox, body, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${label}">${body}</svg>\n`;

function wordmark({ detail }) {
  const { markup, width } = word();
  const pad = detail ? 22 : 2;
  const ghost = detail ? { x: 6, y: 4 } : { x: 5, y: 4 };
  const left = -pad;
  const viewWidth = width + pad * 2 + ghost.x;
  const viewBox = `${left} -2 ${viewWidth} ${104 + ghost.y}`;
  const defs = `<defs><g id="w" fill-rule="evenodd">${markup}</g>${detail ? `
<clipPath id="keep"><rect x="${left}" y="-2" width="${viewWidth}" height="58"/><rect x="${left}" y="61" width="${viewWidth}" height="51"/><rect x="${left}" y="56" width="140" height="5"/><rect x="286" y="56" width="${viewWidth}" height="5"/></clipPath>
<clipPath id="bandA"><rect x="140" y="56" width="146" height="5"/></clipPath>
<mask id="cuts" maskUnits="userSpaceOnUse" x="${left}" y="-2" width="${viewWidth}" height="112"><rect x="${left}" y="-2" width="${viewWidth}" height="112" fill="#fff"/><rect x="0" y="33" width="118" height="2.2" fill="#000"/><rect x="300" y="72" width="130" height="2.2" fill="#000"/></mask>` : ""}</defs>`;
  const layers = detail ? [
    `<use href="#w" fill="${TEAL}" transform="translate(-3 2)" opacity=".55"/>`,
    `<use href="#w" fill="${BLUE}" transform="translate(${ghost.x} ${ghost.y})"/>`,
    `<g fill="${WHITE}" mask="url(#cuts)"><use href="#w" clip-path="url(#keep)"/><g clip-path="url(#bandA)"><use href="#w" transform="translate(6 0)"/></g></g>`,
    `<rect x="${left}" y="45" width="30" height="5" fill="${BLUE}"/><rect x="${width - 8}" y="53" width="${pad + 14}" height="4" fill="${BLUE}"/>`
  ] : [
    `<use href="#w" fill="${BLUE}" transform="translate(${ghost.x} ${ghost.y})"/>`,
    `<use href="#w" fill="${WHITE}"/>`
  ];
  return svg(viewBox, defs + layers.join(""), "OUTARCH");
}

// The O on its tile. 64 units square; the glyph is the wordmark's O.
function mark() {
  const O = GLYPHS[0].d;
  const scale = 0.47;
  const gx = 32 - (64 * scale) / 2;
  const gy = 32 - (100 * scale) / 2;
  const glyph = (fill, dx = 0, dy = 0, extra = "") => `<path fill="${fill}" fill-rule="evenodd" transform="translate(${gx + dx} ${gy + dy}) scale(${scale})" d="${O}"${extra}/>`;
  const body = `<defs>
<linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#161a22"/><stop offset="1" stop-color="#050608"/></linearGradient>
<clipPath id="top"><rect width="64" height="26.5"/><rect y="30" width="64" height="34"/></clipPath>
<clipPath id="band"><rect y="26.5" width="64" height="3.5"/></clipPath>
</defs>
<rect x=".5" y=".5" width="63" height="63" rx="15" fill="url(#tile)" stroke="#ffffff" stroke-opacity=".14"/>
${glyph(BLUE, 2.2, 1.6)}
<g clip-path="url(#top)">${glyph(WHITE)}</g>
<g clip-path="url(#band)">${glyph(WHITE, 2.6)}</g>
<rect x="9" y="37.5" width="12" height="2.6" rx=".6" fill="${BLUE}"/>
<rect x="44" y="19.5" width="9" height="2" rx=".5" fill="${WHITE}"/>`;
  return svg("0 0 64 64", body, "OUTARCH");
}

fs.writeFileSync(path.join(OUT, "outarch-mark.svg"), mark());
fs.writeFileSync(path.join(OUT, "outarch-wordmark.svg"), wordmark({ detail: true }));
fs.writeFileSync(path.join(OUT, "outarch-wordmark-sm.svg"), wordmark({ detail: false }));
console.log("wrote outarch-mark.svg, outarch-wordmark.svg, outarch-wordmark-sm.svg");
