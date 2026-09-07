import React from "react";

/**
 * True when motion should be suppressed — either the OS `prefers-reduced-motion`
 * setting or the in-app Motion = Reduced preference (the `.shell` carries a
 * `motion-reduced` class). JavaScript-driven animation must consult this, not
 * only CSS `@media` rules.
 */
export function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  const os = typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const inApp = typeof document !== "undefined"
    && document.querySelector(".shell.motion-reduced") != null;
  return Boolean(os || inApp);
}

export default function useReducedMotion() {
  const [reduced, setReduced] = React.useState(prefersReducedMotion);

  React.useEffect(() => {
    const update = () => setReduced(prefersReducedMotion());
    const media = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    media?.addEventListener?.("change", update);
    // The in-app preference toggles a class on `.shell`; watch for it.
    const observer = new MutationObserver(update);
    try {
      observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["class"] });
    } catch { /* jsdom / non-DOM environments */ }
    update();
    return () => {
      media?.removeEventListener?.("change", update);
      observer.disconnect();
    };
  }, []);

  return reduced;
}
