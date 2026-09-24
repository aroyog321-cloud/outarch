// Keyboard paste and large input for the terminal panes.
//
// xterm turns Ctrl V (and Ctrl Shift V, Shift Insert) into control
// characters and cancels the key, so on Windows and Linux the browser never
// fires the paste event xterm's own paste handling listens for. PowerShell's
// line editor happened to treat the ^V it received as "paste", which hid the
// problem there; every other program (Claude Code, Codex, cmd, node, python)
// received a raw ^V and nothing was pasted. Letting the chord pass lets the
// browser paste into xterm's input field, and xterm then pastes the text the
// way terminals do: line endings as Enter, and wrapped in bracketed-paste
// markers when the program asked for them.

/** True for the keys that paste in a terminal on Windows and Linux. */
export function isPasteChord(event) {
  if (!event || event.type !== "keydown") return false;
  const key = String(event.key || "").toLowerCase();
  const accelerator = event.ctrlKey || event.metaKey;
  if (accelerator && !event.altKey && key === "v") return true;
  return event.shiftKey && !accelerator && !event.altKey && key === "insert";
}

/**
 * Alt V is how Claude Code on Windows pastes an image (Ctrl V is the
 * terminal's text paste there). No OUTARCH shortcut uses it, so it goes to
 * the program in the terminal instead of being held for the workspace.
 */
export function isShellAltChord(event) {
  if (!event || !event.altKey || event.ctrlKey || event.metaKey) return false;
  return String(event.key || "").toLowerCase() === "v";
}

// The protocol refuses one write over 64 KB. A paste can be larger, so
// input is sent in pieces well under that, in order.
export const TERMINAL_INPUT_CHUNK_BYTES = 16 * 1024;

function utf8Length(codePoint) {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/** Split terminal input into pieces of at most maxBytes UTF-8 bytes, never inside a character. */
export function chunkTerminalInput(data, maxBytes = TERMINAL_INPUT_CHUNK_BYTES) {
  const text = String(data ?? "");
  if (!text) return [];
  // Most input is one keystroke; only long text needs measuring.
  if (text.length * 3 <= maxBytes) return [text];
  const chunks = [];
  let start = 0;
  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    const codePoint = text.codePointAt(index);
    const width = codePoint > 0xffff ? 2 : 1;
    const size = utf8Length(codePoint);
    if (bytes + size > maxBytes && index > start) {
      chunks.push(text.slice(start, index));
      start = index;
      bytes = 0;
    }
    bytes += size;
    index += width;
  }
  if (start < text.length) chunks.push(text.slice(start));
  return chunks;
}
