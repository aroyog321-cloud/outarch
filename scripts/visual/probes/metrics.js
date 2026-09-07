/* In-page measurement probe. Injected by scripts/visual/probe-metrics.cjs.
   Kept in its own file so no template literal is ever nested inside the
   harness's executeJavaScript() string - that failure mode hangs the run
   rather than erroring (see redesign/README.md). */
(function () {
  function describe(node) {
    if (!node || node === document.documentElement) return "html";
    var cls = node.className && node.className.baseVal !== undefined ? node.className.baseVal : node.className;
    var name = node.tagName.toLowerCase();
    if (cls) name += "." + String(cls).trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
    return name;
  }

  function parseColor(value) {
    var match = String(value || "").match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    var parts = match[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some(function (n) { return !isFinite(n); })) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }

  function over(top, bottom) {
    var a = top.a;
    if (a >= 1) return { r: top.r, g: top.g, b: top.b, a: 1 };
    return {
      r: top.r * a + bottom.r * (1 - a),
      g: top.g * a + bottom.g * (1 - a),
      b: top.b * a + bottom.b * (1 - a),
      a: 1
    };
  }

  /* The painted background behind an element: walk up until an opaque layer is
     found, compositing every translucent layer on the way down.

     A gradient stops the walk and yields NO answer. `getComputedStyle` reports
     `background-image` separately from `background-color`, and a gradient-only
     layer therefore reads as transparent - so continuing past it composites the
     text against something the eye never sees, and every element over a
     gradient gets reported as a failure at a colour it does not have. Returning
     null makes the caller skip it and say so, which is the honest answer. */
  function backdrop(node) {
    var stack = [];
    for (var el = node; el; el = el.parentElement) {
      var style = getComputedStyle(el);
      if (style.backgroundImage && style.backgroundImage !== "none") return null;
      var colour = parseColor(style.backgroundColor);
      if (!colour || colour.a === 0) continue;
      stack.push(colour);
      if (colour.a >= 1) break;
    }
    var base = { r: 255, g: 255, b: 255, a: 1 };
    for (var i = stack.length - 1; i >= 0; i -= 1) base = over(stack[i], base);
    return base;
  }

  /* Terminal output is painted by xterm into a canvas and mirrored into a
     transparent DOM layer for assistive technology. That layer is invisible by
     design, so measuring its contrast measures nothing. */
  function inTerminalCanvas(node) {
    for (var el = node; el; el = el.parentElement) {
      if (el.classList && (el.classList.contains("xterm") || el.classList.contains("xterm-accessibility"))) return true;
    }
    return false;
  }

  function channel(value) {
    var c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function luminance(colour) {
    return 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b);
  }

  function contrast(fg, bg) {
    var a = luminance(fg) + 0.05;
    var b = luminance(bg) + 0.05;
    return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
  }

  function visible(node) {
    var style = getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
    var box = node.getBoundingClientRect();
    return box.width > 1 && box.height > 1;
  }

  function ownText(node) {
    var text = "";
    for (var i = 0; i < node.childNodes.length; i += 1) {
      if (node.childNodes[i].nodeType === 3) text += node.childNodes[i].textContent;
    }
    return text.replace(/\s+/g, " ").trim();
  }

  window.__mcProbe = {
    /* T101/T102 - how much of the first screen the register actually gets, and
       in what order the operator meets the page. */
    fold: function (selectors) {
      var viewport = window.innerHeight;
      var out = { viewport: viewport, documentScroll: document.documentElement.scrollHeight, regions: [] };
      selectors.forEach(function (selector) {
        var node = document.querySelector(selector);
        if (!node) { out.regions.push({ selector: selector, present: false }); return; }
        var box = node.getBoundingClientRect();
        var top = box.top + window.scrollY;
        var withinFold = Math.max(0, Math.min(box.bottom, viewport) - Math.max(box.top, 0));
        out.regions.push({
          selector: selector,
          present: true,
          top: Math.round(top),
          height: Math.round(box.height),
          withinFold: Math.round(withinFold),
          foldShare: Math.round((withinFold / viewport) * 1000) / 10
        });
      });
      return out;
    },

    /* T108 - a scroll container inside a scroll container is the defect; report
       every nested pair with its depth. */
    scrollNesting: function (rootSelector) {
      var root = document.querySelector(rootSelector) || document.body;
      var scrollers = [];
      var all = [root].concat([].slice.call(root.querySelectorAll("*")));
      all.forEach(function (el) {
        var style = getComputedStyle(el);
        var scrollsY = /auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 2;
        if (scrollsY && visible(el)) scrollers.push(el);
      });
      var pageScrolls = document.documentElement.scrollHeight > document.documentElement.clientHeight + 2;
      return {
        pageScrolls: pageScrolls,
        pageOverflowPx: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        scrollers: scrollers.map(function (el) {
          var depth = 0;
          for (var n = el.parentElement; n; n = n.parentElement) if (scrollers.indexOf(n) >= 0) depth += 1;
          return {
            node: describe(el),
            overflowPx: el.scrollHeight - el.clientHeight,
            nestedInsideScrollers: depth,
            alsoInsidePageScroll: pageScrolls
          };
        })
      };
    },

    /* T137 - measured contrast, not asserted contrast. Text under 24px (or 19px
       bold) needs 4.5; larger text and UI borders need 3. */
    contrast: function (rootSelector) {
      var root = document.querySelector(rootSelector) || document.body;
      var findings = [];
      var nodes = [].slice.call(root.querySelectorAll("*"));
      var skipped = 0;
      nodes.forEach(function (el) {
        var text = ownText(el);
        if (!text || !visible(el)) return;
        if (inTerminalCanvas(el)) return;
        var style = getComputedStyle(el);
        var fg = parseColor(style.color);
        if (!fg) return;
        if (fg.a === 0) return; // deliberately invisible (accessibility mirrors, measuring shims)
        var bg = backdrop(el);
        if (!bg) { skipped += 1; return; }
        var flat = fg.a < 1 ? over(fg, bg) : fg;
        var size = parseFloat(style.fontSize) || 16;
        var weight = Number(style.fontWeight) || 400;
        var large = size >= 24 || (size >= 18.66 && weight >= 700);
        var required = large ? 3 : 4.5;
        var ratio = contrast(flat, bg);
        if (ratio + 0.005 < required) {
          findings.push({
            node: describe(el),
            text: text.slice(0, 46),
            ratio: ratio,
            required: required,
            size: Math.round(size * 10) / 10,
            weight: weight,
            color: style.color,
            behind: "rgb(" + Math.round(bg.r) + "," + Math.round(bg.g) + "," + Math.round(bg.b) + ")"
          });
        }
      });
      findings.sort(function (a, b) { return a.ratio - b.ratio; });
      return { findings: findings.slice(0, 40), unresolvable: skipped };
    },

    /* T140 - everything the keyboard can reach, in the order it reaches it,
       plus anything interactive it cannot reach at all. */
    focusOrder: function (rootSelector) {
      var root = document.querySelector(rootSelector) || document.body;
      var FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex],[contenteditable="true"]';
      var candidates = [].slice.call(root.querySelectorAll(FOCUSABLE));
      var reachable = [];
      var unreachable = [];
      var offscreen = [];
      // A `tabindex="-1"` member of a composite widget IS keyboard reachable:
      // the group holds one tab stop and the arrow keys move within it. Counting
      // those as unreachable would report the WAI-ARIA grid and tabs patterns as
      // defects, which is the opposite of the truth.
      var ROVING = '[role="grid"],[role="tablist"],[role="listbox"],[role="menu"],[role="menubar"],[role="radiogroup"],[role="tree"],[role="toolbar"]';
      var roving = function (el) { return Boolean(el.closest(ROVING)); };
      candidates.forEach(function (el) {
        if (inTerminalCanvas(el) || el.closest(".xterm-helpers")) return;
        var disabled = el.disabled === true || el.getAttribute("aria-disabled") === "true";
        var tabindex = el.getAttribute("tabindex");
        var inTabOrder = !disabled && (tabindex !== "-1" || roving(el)) && visible(el);
        var label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 40);
        var entry = { node: describe(el), label: label, tabindex: tabindex };
        if (!inTabOrder) {
          if (!disabled && !visible(el) && el.offsetParent === null) return; // genuinely not rendered
          if (!disabled) unreachable.push(entry);
          return;
        }
        var box = el.getBoundingClientRect();
        if (box.right > window.innerWidth + 1 || box.left < -1) {
          offscreen.push(Object.assign({ right: Math.round(box.right), viewport: window.innerWidth }, entry));
        }
        reachable.push(entry);
      });
      return { count: reachable.length, reachable: reachable, unreachable: unreachable, clippedOutOfView: offscreen };
    },

    /* T140 - what the keyboard can focus but the eye cannot see. A control
       pushed past the right edge of a container that clips is reachable and
       invisible, which is worse than either. */
    horizontal: function (rootSelector) {
      var root = document.querySelector(rootSelector) || document.body;
      var doc = document.documentElement;
      var offenders = [];
      [].slice.call(root.querySelectorAll("*")).forEach(function (el) {
        if (el.scrollWidth <= el.clientWidth + 2) return;
        var style = getComputedStyle(el);
        offenders.push({
          node: describe(el),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          overflowX: style.overflowX,
          reachableByScroll: /auto|scroll/.test(style.overflowX)
        });
      });
      return { pageHorizontalPx: doc.scrollWidth - doc.clientWidth, offenders: offenders.slice(0, 10) };
    },

    /* T136 - what a screen reader meets, in DOM order: landmarks, headings and
       live regions. Announcement order follows this, not visual order. */
    announceOrder: function (rootSelector) {
      var root = document.querySelector(rootSelector) || document.body;
      var SELECTOR = 'h1,h2,h3,h4,[role="region"],[role="log"],[role="status"],[role="alert"],[aria-live],main,nav,aside,[role="complementary"],[role="navigation"],[role="dialog"],[role="alertdialog"],[role="grid"],[role="tablist"]';
      // Announced, not painted: a clipped `.sr-only` heading is 1x1 and still
      // reaches the accessibility tree, so `visible()` is the wrong filter here.
      // What actually removes a node from that tree is display/visibility or an
      // explicit aria-hidden.
      var announced = function (el) {
        if (el.closest("[aria-hidden='true']")) return false;
        var style = getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden";
      };
      return [].slice.call(root.querySelectorAll(SELECTOR)).filter(announced).map(function (el) {
        return {
          node: describe(el),
          role: el.getAttribute("role") || el.tagName.toLowerCase(),
          live: el.getAttribute("aria-live") || null,
          name: (el.getAttribute("aria-label") || (/^h[1-4]$/i.test(el.tagName) ? el.textContent : "") || "").replace(/\s+/g, " ").trim().slice(0, 60)
        };
      });
    },

    /* T164 - every rendered element actually set in monospace, with its text,
       so "monospace means machine-exact" can be checked rather than asserted. */
    monospace: function (rootSelector) {
      var root = document.querySelector(rootSelector) || document.body;
      var out = [];
      [].slice.call(root.querySelectorAll("*")).forEach(function (el) {
        if (inTerminalCanvas(el)) return;
        var text = ownText(el);
        if (!text || !visible(el)) return;
        var family = getComputedStyle(el).fontFamily.toLowerCase();
        if (!/mono|consolas|menlo|cascadia|courier/.test(family)) return;
        out.push({ node: describe(el), tag: el.tagName.toLowerCase(), text: text.slice(0, 40) });
      });
      return out.slice(0, 60);
    },

    /* T152/T153 - the real distribution of the values a design system claims to
       own. Every measurement is read off the rendered box, not the source. */
    scale: function (rootSelector) {
      var root = document.querySelector(rootSelector) || document.body;
      var radii = {};
      var heights = {};
      var icons = {};
      var gaps = {};
      [].slice.call(root.querySelectorAll("*")).forEach(function (el) {
        if (!visible(el)) return;
        var style = getComputedStyle(el);
        var radius = style.borderTopLeftRadius;
        if (radius && radius !== "0px") radii[radius] = (radii[radius] || 0) + 1;
        if (style.display === "grid" || style.display === "flex") {
          var gap = style.rowGap + "/" + style.columnGap;
          if (gap !== "normal/normal") gaps[gap] = (gaps[gap] || 0) + 1;
        }
        var tag = el.tagName.toLowerCase();
        if (tag === "button" || el.getAttribute("role") === "button") {
          var h = Math.round(el.getBoundingClientRect().height);
          if (h > 0) heights[h] = (heights[h] || 0) + 1;
        }
        // Only the ICON SET. A sparkline, a mission-graph node and a QR code
        // are SVGs too, and counting them would report a size spread that no
        // amount of icon normalisation could ever close.
        if (tag === "svg" && el.classList.contains("icon")) {
          var box = el.getBoundingClientRect();
          var key = Math.round(box.width) + "x" + Math.round(box.height) + " stroke:" + style.strokeWidth;
          icons[key] = (icons[key] || 0) + 1;
        }
      });
      var top = function (map, n) {
        return Object.keys(map).sort(function (a, b) { return map[b] - map[a]; }).slice(0, n).map(function (k) { return k + " x" + map[k]; });
      };
      return {
        radiusValues: Object.keys(radii).length,
        radii: top(radii, 12),
        controlHeightValues: Object.keys(heights).length,
        controlHeights: top(heights, 12),
        iconSizes: top(icons, 14),
        gaps: top(gaps, 12)
      };
    }
  };
  return true;
})();
