// The native window controls (minimise, maximise, close) are painted by the
// system over the top-right of the window, in a colour the main process picks.
// A fixed guess drifted from the strip they sit on — they read as a dark box
// pasted onto the status tape — so the colour is taken from what the tape
// actually paints: its background, composited over whatever is behind it.

function parseColor(value) {
  const text = String(value || "").trim();
  let match = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (match) {
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some(part => !Number.isFinite(part))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: Number.isFinite(parts[3]) ? parts[3] : 1 };
  }
  // Colours produced by color-mix() compute to the color() syntax, 0..1 per channel.
  match = /^color\(srgb\s+([^)]+)\)$/i.exec(text);
  if (match) {
    const [channels, alpha] = match[1].split("/");
    const parts = channels.trim().split(/\s+/).map(Number);
    if (parts.length < 3 || parts.some(part => !Number.isFinite(part))) return null;
    const a = alpha === undefined ? 1 : Number(alpha);
    return { r: parts[0] * 255, g: parts[1] * 255, b: parts[2] * 255, a: Number.isFinite(a) ? a : 1 };
  }
  return null;
}

const hex = channel => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0");

// The colour a viewer sees at `element`: its own background over each ancestor
// background until one is opaque. The window itself is black underneath.
export function paintedBackground(element) {
  const layers = [];
  for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
    const color = parseColor(window.getComputedStyle(node).backgroundColor);
    if (!color || color.a <= 0) continue;
    layers.push(color);
    if (color.a >= 1) break;
  }
  let result = { r: 0, g: 0, b: 0 };
  for (const layer of layers.reverse()) {
    const a = Math.min(1, layer.a);
    result = { r: layer.r * a + result.r * (1 - a), g: layer.g * a + result.g * (1 - a), b: layer.b * a + result.b * (1 - a) };
  }
  return `#${hex(result.r)}${hex(result.g)}${hex(result.b)}`;
}

// Tell the main process which strip the controls sit on. Focus mode keeps its
// own shallower strip in the same colour, so the mode is read from the document
// rather than remembered here. Presentation only; a failure changes nothing.
export function syncWindowChrome() {
  try {
    const bar = document.querySelector(".mission-status-bar");
    const setWindowChrome = window.missionControl?.setWindowChrome;
    if (!bar || typeof setWindowChrome !== "function") return;
    const mode = document.documentElement.dataset.workspaceFocus === "on" ? "focus" : "standard";
    setWindowChrome({ mode, color: paintedBackground(bar) })?.catch?.(() => {});
  } catch {
    // The controls keep the colour they were created with.
  }
}
