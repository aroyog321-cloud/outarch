// Reports every painted colour that is NOT in the Obsidian palette.
//
// A palette swap that only edits tokens leaves behind the rules that named a
// colour literally. Those are invisible in a diff and obvious on screen, so
// this walks what actually painted and groups the strays by value, naming the
// elements that carry each one. Loaded as a string by probe-palette.cjs, so
// keep it ES5-ish and free of template literals.
(function () {
  "use strict";

  // Obsidian: black canvas, one graphite surface, white ink, one blue, three
  // status inks. Anything outside this set is a stray unless it is a neutral
  // grey (a border wash) or fully transparent.
  var PALETTE = [
    [0, 0, 0], [16, 16, 16], [23, 23, 23], [31, 31, 31], [41, 41, 41],
    [255, 255, 255], [250, 250, 250], [161, 161, 161],
    [0, 112, 243], [50, 145, 255], [108, 178, 255],
    [50, 213, 131], [245, 185, 66], [255, 95, 95]
  ];

  function parse(value) {
    if (!value) return null;
    var m = value.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    var parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some(isNaN)) return null;
    var alpha = parts.length > 3 ? parts[3] : 1;
    return { r: parts[0], g: parts[1], b: parts[2], a: alpha };
  }

  // A colour composited over the canvas at low alpha is a wash, not a hue
  // choice; judge the hue it would paint at full strength instead.
  function nearest(c) {
    var best = 1e9;
    for (var i = 0; i < PALETTE.length; i += 1) {
      var p = PALETTE[i];
      var d = Math.abs(p[0] - c.r) + Math.abs(p[1] - c.g) + Math.abs(p[2] - c.b);
      if (d < best) best = d;
    }
    return best;
  }

  // Neutral means the three channels agree: any grey is a legitimate border or
  // scrim in this system, whatever its exact level.
  function neutral(c) {
    return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) <= 6;
  }

  function name(node) {
    var cls = node.className && node.className.baseVal !== undefined ? node.className.baseVal : node.className;
    var tag = node.tagName.toLowerCase();
    if (!cls) return tag;
    return tag + "." + String(cls).split(/\s+/).filter(Boolean).slice(0, 2).join(".");
  }

  var strays = {};
  function record(value, property, node) {
    var c = parse(value);
    if (!c || c.a === 0) return;
    if (neutral(c)) return;
    if (nearest(c) <= 24) return;
    var key = property + " " + value;
    if (!strays[key]) strays[key] = { property: property, value: value, count: 0, where: [] };
    strays[key].count += 1;
    if (strays[key].where.length < 5) strays[key].where.push(name(node));
  }

  var nodes = document.querySelectorAll(".shell *");
  for (var i = 0; i < nodes.length; i += 1) {
    var el = nodes[i];
    var box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    var style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") continue;

    record(style.color, "color", el);
    if (style.backgroundColor !== "rgba(0, 0, 0, 0)") record(style.backgroundColor, "background", el);
    for (var s = 0; s < 4; s += 1) {
      var side = ["Top", "Right", "Bottom", "Left"][s];
      if (parseFloat(style["border" + side + "Width"]) > 0) record(style["border" + side + "Color"], "border", el);
    }
    // A gradient or shadow cannot be resolved to one colour, so report the
    // declaration itself when it names a hue the palette does not contain.
    var extra = style.backgroundImage + " " + style.boxShadow;
    var found = extra.match(/rgba?\([^)]+\)/g) || [];
    for (var g = 0; g < found.length; g += 1) record(found[g], "gradient/shadow", el);
  }

  return Object.keys(strays)
    .map(function (k) { return strays[k]; })
    .sort(function (a, b) { return b.count - a.count; })
    .slice(0, 40);
})();
