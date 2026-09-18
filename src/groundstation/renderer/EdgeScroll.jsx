import React from "react";
import { prefersReducedMotion } from "./useReducedMotion.js";

// A row that can hold more than fits (the off-canvas roster, the folder rail).
// A native horizontal scrollbar under a 24px row doubled its visual weight and
// knocked the chips off centre, so the row scrolls without one:
//   - the clipped end fades, which says there is more;
//   - a chevron at that end pages the row for a pointer;
//   - a vertical wheel scrolls it sideways, but only while it can move, so the
//     page still scrolls at either end;
//   - keyboard focus scrolls a chip into view natively, so the chevrons are
//     pointer-only and stay out of the tab order and the accessibility tree.
// The scroller is the child marked `data-edge-scroller`; its own markup and
// styles are untouched.
export function EdgeScroll({ className = "", children }) {
  const frameRef = React.useRef(null);
  const [edges, setEdges] = React.useState({ start: false, end: false });

  React.useEffect(() => {
    const scroller = frameRef.current?.querySelector(":scope > [data-edge-scroller]");
    if (!scroller) return undefined;
    const update = () => {
      const room = scroller.scrollWidth - scroller.clientWidth;
      const start = room > 1 && scroller.scrollLeft > 1;
      const end = room > 1 && room - scroller.scrollLeft > 1;
      setEdges(previous => (previous.start === start && previous.end === end ? previous : { start, end }));
    };
    const onWheel = event => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const room = scroller.scrollWidth - scroller.clientWidth;
      if (room <= 0) return;
      const next = Math.max(0, Math.min(room, scroller.scrollLeft + event.deltaY));
      if (next === scroller.scrollLeft) return;
      event.preventDefault();
      scroller.scrollLeft = next;
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    scroller.addEventListener("wheel", onWheel, { passive: false });
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    resize?.observe(scroller);
    const mutation = new MutationObserver(update);
    mutation.observe(scroller, { childList: true, subtree: true, characterData: true });
    return () => {
      scroller.removeEventListener("scroll", update);
      scroller.removeEventListener("wheel", onWheel);
      resize?.disconnect();
      mutation.disconnect();
    };
  }, []);

  const page = direction => {
    const scroller = frameRef.current?.querySelector(":scope > [data-edge-scroller]");
    if (!scroller) return;
    scroller.scrollBy({ left: direction * Math.max(120, scroller.clientWidth * 0.75), behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };

  const classes = ["edge-scroll", edges.start ? "has-start" : "", edges.end ? "has-end" : "", className].filter(Boolean).join(" ");
  return <div ref={frameRef} className={classes}>
    {children}
    <button type="button" className="edge-scroll__nudge is-start" tabIndex={-1} aria-hidden="true" onClick={() => page(-1)}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m15 18-6-6 6-6"/></svg>
    </button>
    <button type="button" className="edge-scroll__nudge is-end" tabIndex={-1} aria-hidden="true" onClick={() => page(1)}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6"/></svg>
    </button>
  </div>;
}
