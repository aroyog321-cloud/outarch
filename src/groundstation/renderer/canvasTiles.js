// Per-terminal sizing for the workspace canvas.
//
// The canvas is read as rows of tiles. Every tile owns its width within its
// row, and every row owns its height, so dragging one terminal's edge or corner
// resizes that terminal and the tiles beside it give way — the way an image is
// resized, instead of dragging a shared boundary line. It holds in every canvas
// mode: the slot layouts, the focus-mode mosaic, and a canvas packed around the
// browser or the assistant.
//
// Sizes are fractions (each row's widths, and the row heights, sum to 1), so a
// stored arrangement reads the same at any window size. Rendering stays one
// flat CSS grid: the column lines of every row are merged into one track list
// and each tile is placed between its own two lines. Nothing is wrapped or
// reparented, so an xterm is never unmounted to be resized.

export const TILE_MIN_WIDTH = 200;
export const TILE_MIN_HEIGHT = 120;
// A dragged edge that lands this close to an edge in another row joins it, so
// rows line up without having to be placed to the pixel.
const SNAP_PX = 12;
// Lines closer than this share one grid line. Keeps tracks from being thinner
// than the gap between them.
const MERGE_PX = 10;

const even = count => Array.from({ length: count }, () => 1 / count);
const sum = list => list.reduce((total, value) => total + value, 0);

// How many tiles each row holds: full rows of `columns`, then the remainder.
export function tileRows(count, columns) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  const width = Math.max(1, Math.floor(Number(columns) || 0));
  const rows = [];
  for (let left = total; left > 0; left -= width) rows.push(Math.min(width, left));
  return rows;
}

export function tileShapeKey(mode, rows) {
  return Array.isArray(rows) && rows.length ? `${mode}:${rows.join(",")}` : "";
}

function fractions(list, length) {
  if (!Array.isArray(list) || list.length !== length || !list.every(value => Number.isFinite(value) && value > 0)) return null;
  const total = sum(list);
  return list.map(value => value / total);
}

// A stored arrangement is untrusted: it outlives releases and can describe a
// canvas with a different number of tiles. Anything that does not fit this
// shape falls back to even sizes, axis by axis and row by row.
export function normalizeTileSizes(stored, rows) {
  const source = stored && typeof stored === "object" ? stored : {};
  const cells = Array.isArray(source.cells) ? source.cells : [];
  return {
    rows: fractions(source.rows, rows.length) || even(rows.length),
    cells: rows.map((count, index) => fractions(cells[index], count) || even(count))
  };
}

// Where a canvas position sits: its row, and its cell within that row.
export function tileAddress(rows, position) {
  let start = 0;
  for (let row = 0; row < rows.length; row += 1) {
    if (position < start + rows[row]) return position >= start ? { row, cell: position - start } : null;
    start += rows[row];
  }
  return null;
}

// Which edges of a tile can move. An edge on the border of the canvas has
// nothing to push against, so it is not offered.
export function tileEdges(rows, address, { vertical = true } = {}) {
  if (!address) return [];
  const left = address.cell > 0;
  const right = address.cell < rows[address.row] - 1;
  const top = vertical && address.row > 0;
  const bottom = vertical && address.row < rows.length - 1;
  return [
    top && left && "nw", top && "n", top && right && "ne",
    left && "w", right && "e",
    bottom && left && "sw", bottom && "s", bottom && right && "se"
  ].filter(Boolean);
}

// The flat grid that draws a set of sizes, for a canvas `width` pixels wide
// with `gap` pixels between tiles.
//
// Every row is laid out as if it were on its own — its widths share what its
// own gaps leave — and the place each tile ends is a cut. Cuts from all rows
// become one track list, so a tile spanning several tracks is exactly as wide
// as its fraction says, and a row of five sits over a row of three without
// either being bent to fit the other. Cuts closer than a gap share a line.
export function tileGrid(sizes, width = 0, gap = 0) {
  const W = width > 0 ? width : 1000;
  const g = width > 0 ? Math.max(0, gap) : 0;
  const rowCuts = sizes.cells.map(cells => {
    const usable = W - (cells.length - 1) * g;
    let at = 0;
    return cells.slice(0, -1).map((value, index) => (at += value * usable) + index * g);
  });
  const cuts = [];
  for (const value of rowCuts.flat().sort((a, b) => a - b)) {
    const previous = cuts.length ? cuts[cuts.length - 1] : -g;
    if (value - previous >= g + MERGE_PX && W - value >= g + MERGE_PX) cuts.push(value);
  }
  const nearest = value => {
    let best = 0;
    for (let index = 1; index < cuts.length; index += 1) if (Math.abs(cuts[index] - value) < Math.abs(cuts[best] - value)) best = index;
    return best;
  };
  const trackCount = cuts.length + 1;
  const placements = [];
  let valid = true;
  rowCuts.forEach((row, rowIndex) => {
    let start = 0;
    for (let cell = 0; cell <= row.length; cell += 1) {
      let end = cell === row.length ? trackCount : nearest(row[cell]) + 1;
      if (end <= start) { end = start + 1; valid = false; }
      if (end > trackCount) valid = false;
      placements.push({ row: rowIndex, cell, start, end, column: `${start + 1} / ${end + 1}`, gridRow: `${rowIndex + 1}` });
      start = end;
    }
  });
  const edges = [-g, ...cuts, W];
  const tracks = edges.slice(1).map((value, index) => Math.max(1, value - edges[index] - g));
  return { tracks, placements, valid };
}

export function tileTemplates(sizes, grid, rowMin = "0px") {
  const round = value => Math.max(0.01, Math.round(value * 100) / 100);
  return {
    columns: grid.tracks.map(value => `minmax(0, ${round(value)}fr)`).join(" "),
    rows: sizes.rows.map(value => `minmax(${rowMin}, ${round(value * 1000)}fr)`).join(" ")
  };
}

// Grow or shrink item `index` by `growth` pixels, taking the space from (or
// giving it to) the items on one side only, so the opposite edge stays where it
// is. `snap` lists cuts in other rows, in pixels, that the moving edge should
// join when it comes close; `gap` is the space between items.
function push(list, index, side, growth, usable, minimum, snap = [], gap = 0) {
  const others = side === "after"
    ? list.map((_, at) => at).filter(at => at > index)
    : list.map((_, at) => at).filter(at => at < index);
  if (!others.length || !(usable > 0)) return list;
  const px = list.map(value => value * usable);
  const floor = Math.min(minimum, usable / list.length);
  const room = sum(others.map(at => Math.max(0, px[at] - floor)));
  const lowest = Math.min(px[index], floor);
  const clamp = value => Math.min(px[index] + room, Math.max(lowest, value));
  let next = clamp(px[index] + growth);
  const before = sum(px.slice(0, index));
  // The cut the moving edge makes: the end of this item, or the end of the
  // item before it.
  const fixed = before + px[index] + index * gap;
  const cut = side === "after" ? before + index * gap + next : fixed - next - gap;
  const target = snap.find(line => Math.abs(line - cut) <= SNAP_PX);
  if (target !== undefined) next = clamp(side === "after" ? target - before - index * gap : fixed - gap - target);
  const change = next - px[index];
  if (Math.abs(change) < 0.01) return list;
  const out = [...px];
  out[index] = next;
  if (change > 0) {
    const weights = others.map(at => Math.max(0, px[at] - floor));
    const total = sum(weights) || 1;
    others.forEach((at, i) => { out[at] = px[at] - change * (weights[i] / total); });
  } else {
    const total = sum(others.map(at => px[at])) || 1;
    others.forEach(at => { out[at] = px[at] - change * (px[at] / total); });
  }
  const outTotal = sum(out);
  return out.map(value => value / outTotal);
}

// Resize the tile at `address` by dragging `grip` (n, s, e, w or a corner)
// `dx`/`dy` pixels. `metrics` is the canvas as measured: content width and
// height and the gaps between tiles.
export function resizeTile(sizes, rows, address, grip, dx, dy, metrics = {}) {
  if (!address || !grip) return sizes;
  const { width = 0, height = 0, colGap = 0, rowGap = 0, minWidth = TILE_MIN_WIDTH, minHeight = TILE_MIN_HEIGHT } = metrics;
  let cells = sizes.cells;
  let rowSizes = sizes.rows;
  const horizontal = grip.includes("e") ? "after" : grip.includes("w") ? "before" : null;
  const vertical = grip.includes("s") ? "after" : grip.includes("n") ? "before" : null;
  if (horizontal && dx) {
    const count = rows[address.row];
    const usable = width - (count - 1) * colGap;
    // Other rows' lines, so an edge can settle into alignment with them.
    const snap = sizes.cells.flatMap((row, rowIndex) => {
      if (rowIndex === address.row) return [];
      const rowUsable = width - (row.length - 1) * colGap;
      let at = 0;
      return row.slice(0, -1).map((value, index) => (at += value * rowUsable) + index * colGap);
    });
    const next = push(sizes.cells[address.row], address.cell, horizontal, horizontal === "after" ? dx : -dx, usable, minWidth, snap, colGap);
    cells = sizes.cells.map((row, index) => (index === address.row ? next : row));
  }
  if (vertical && dy) {
    const usable = height - (rows.length - 1) * rowGap;
    rowSizes = push(sizes.rows, address.row, vertical, vertical === "after" ? dy : -dy, usable, minHeight);
  }
  return cells === sizes.cells && rowSizes === sizes.rows ? sizes : { rows: rowSizes, cells };
}

// Double-click on a grip evens out what that grip moves: the tile's row for a
// side edge, the row heights for a top or bottom edge, both for a corner.
export function evenTileSizes(sizes, rows, address, grip) {
  if (!address || !grip) return sizes;
  const horizontal = /[ew]/.test(grip);
  const vertical = /[ns]/.test(grip);
  return {
    rows: vertical ? even(rows.length) : sizes.rows,
    cells: horizontal ? sizes.cells.map((row, index) => (index === address.row ? even(rows[index]) : row)) : sizes.cells
  };
}

// The slot layouts used to keep one split per axis. An operator who dragged
// those should find the same proportions the first time the canvas is sized
// per tile, so they seed the tiles until a tile is resized.
export function seedFromRatios(layoutId, ratios) {
  const col = Number(ratios?.col) || 50;
  const col2 = Number(ratios?.col2) || 25;
  const row = Number(ratios?.row) || 50;
  const heights = [row, 100 - row];
  switch (layoutId) {
    case "horizontal": return { cells: [[col, 100 - col]] };
    case "vertical": return { rows: heights };
    case "grid-2x2": return { rows: heights, cells: [[col, 100 - col], [col, 100 - col]] };
    case "grid-3x2": {
      const third = Math.max(1, 100 - col - col2);
      return { rows: heights, cells: [[col, col2, third], [col, col2, third]] };
    }
    default: return null;
  }
}
