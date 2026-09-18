// Copy text for the operator.
//
// The page's own clipboard API refuses whenever the window does not have focus,
// which is exactly when a notification's "Copy" action runs, and it reports that
// as a raw browser error. The app copies through its main process first, which
// works either way; the page clipboard and a hidden field are the fallbacks for
// hosts without that bridge.

export const COPY_FAILED_MESSAGE = "Could not copy to the clipboard. Click inside the window and try again.";

export async function copyText(text) {
  const value = String(text ?? "");
  const bridge = typeof window !== "undefined" ? window.missionControl : null;
  if (typeof bridge?.copyText === "function") {
    try {
      await bridge.copyText(value);
      return true;
    } catch {
      // Fall through to the page clipboard.
    }
  }
  if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the hidden field.
    }
  }
  if (typeof document !== "undefined" && document.body && typeof document.execCommand === "function") {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.setAttribute("aria-hidden", "true");
    field.style.position = "fixed";
    field.style.opacity = "0";
    field.style.pointerEvents = "none";
    document.body.appendChild(field);
    let copied = false;
    try {
      field.select();
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    } finally {
      field.remove();
    }
    if (copied) return true;
  }
  throw new Error(COPY_FAILED_MESSAGE);
}
