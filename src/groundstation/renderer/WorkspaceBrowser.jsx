import React from "react";
import { missionApi } from "./missionApi.js";

// The Mission Control browser tile.
//
// The page itself is not rendered by React: it is a real browser view owned by
// the main process, painted over the rectangle this component reserves. So the
// component's job is threefold — draw the chrome around it, keep the main
// process told where the rectangle is, and get out of the way when something
// that must be on top of it appears.
//
// Because the view is a native child of the window, it does not participate in
// stacking with the DOM. A modal dialog would render *behind* it. The observer
// below watches for a portalled dialog and hides the view while one is open,
// which is the same trick a browser uses for its own native widgets.

function chromeIcon(name) {
  const paths = {
    back: <path d="M15 18l-6-6 6-6"/>,
    forward: <path d="M9 18l6-6-6-6"/>,
    reload: <><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></>,
    external: <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></>,
    close: <><path d="M18 6L6 18"/><path d="M6 6l12 12"/></>
  };
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

const EMPTY_STATE = { available: true, open: false, url: "", title: "", loading: false, error: null, canGoBack: false, canGoForward: false };

export default function WorkspaceBrowser({ style, onClose }) {
  const viewportRef = React.useRef(null);
  const [state, setState] = React.useState(EMPTY_STATE);
  const [address, setAddress] = React.useState("");
  const [editingAddress, setEditingAddress] = React.useState(false);
  const [notice, setNotice] = React.useState("");

  // Engine-reported browser state. Every mutation returns the new state and the
  // main process also broadcasts it, so a change made from the Services panel
  // reaches this chrome without it polling.
  React.useEffect(() => {
    let active = true;
    missionApi().request("workspace.browser.state")
      .then(value => { if (active && value) setState(current => ({ ...current, ...value })); })
      .catch(() => {});
    const unsubscribe = missionApi().subscribe(notification => {
      if (notification?.type !== "workspace:browser" || !active) return;
      setState(current => ({ ...current, ...(notification.state || {}) }));
    });
    return () => { active = false; unsubscribe?.(); };
  }, []);

  React.useEffect(() => {
    if (!editingAddress) setAddress(state.url || "");
  }, [state.url, editingAddress]);

  // Keep the main process told where the reserved rectangle is: on mount, on
  // every resize of the tile, and whenever the window itself changes shape.
  // `hidden` is reported the same way, so one call covers both.
  React.useEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;
    let frame = null;
    let disposed = false;

    const report = () => {
      frame = null;
      if (disposed || !node.isConnected) return;
      const rect = node.getBoundingClientRect();
      // Menus, popovers and tooltips are portalled the same way a dialog is,
      // and all of them would render behind a native view. Radix wraps every
      // one of them in the same positioning element, so one selector covers
      // the whole family without naming each component.
      const overlayOpen = Boolean(document.querySelector(
        "[role='dialog'],[role='alertdialog'],[data-radix-popper-content-wrapper]"
      ));
      // Notifications are not overlays — they do not trap focus and they do not
      // block the page, which is exactly why they stopped claiming a dialog
      // role. But they still paint in DOM, so a native view drawn over one is
      // a notification the operator never sees. This hides the view only while
      // a notification is actually on top of it: a stack in the corner of a
      // window whose browser tile is elsewhere costs the browser nothing.
      const covered = [...document.querySelectorAll(".mc-toast")].some(toast => {
        const box = toast.getBoundingClientRect();
        return box.width > 0 && box.height > 0
          && box.left < rect.right && box.right > rect.left
          && box.top < rect.bottom && box.bottom > rect.top;
      });
      void missionApi().request("workspace.browser.bounds", {
        bounds: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          hidden: overlayOpen || covered || rect.width < 2 || rect.height < 2
        }
      }).catch(() => {});
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(report);
    };

    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(node);
    // Portalled overlays are appended to <body>, so their arrival and departure
    // are visible here without knowing which component opened them.
    const overlayObserver = new MutationObserver(schedule);
    overlayObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    schedule();

    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      overlayObserver.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, []);

  // Closing the tile closes the view. If the tile unmounts for any other reason
  // — leaving the route, a folder filter — the view must go with it, or a page
  // stays painted over a screen that no longer reserves room for it.
  React.useEffect(() => () => {
    void missionApi().request("workspace.browser.command", { action: "close" }).catch(() => {});
  }, []);

  const command = React.useCallback(async action => {
    try {
      const value = await missionApi().request("workspace.browser.command", { action });
      if (value) setState(current => ({ ...current, ...value }));
    } catch (error) {
      setNotice(error?.message || String(error));
    }
  }, []);

  const go = React.useCallback(async raw => {
    const target = String(raw || "").trim();
    if (!target) return;
    setNotice("");
    try {
      const value = await missionApi().request("workspace.browser.open", {
        url: /^https?:\/\//i.test(target) ? target : `http://${target}`
      });
      if (value) setState(current => ({ ...current, ...value }));
    } catch (error) {
      setNotice(error?.message || String(error));
    }
  }, []);

  const openExternally = () => {
    if (state.url) window.missionControl?.openExternal?.(state.url);
  };

  return (
    <section className="workspace-browser" style={style} aria-label="Mission Control browser">
      <header className="workspace-browser__chrome">
        <div className="workspace-browser__nav" role="group" aria-label="Browser navigation">
          <button type="button" onClick={() => command("back")} disabled={!state.canGoBack} aria-label="Back">{chromeIcon("back")}</button>
          <button type="button" onClick={() => command("forward")} disabled={!state.canGoForward} aria-label="Forward">{chromeIcon("forward")}</button>
          <button type="button" onClick={() => command(state.loading ? "stop" : "reload")} aria-label={state.loading ? "Stop loading" : "Reload"}>{chromeIcon("reload")}</button>
        </div>
        <form
          className="workspace-browser__address"
          onSubmit={event => { event.preventDefault(); setEditingAddress(false); void go(address); }}
        >
          <input
            value={address}
            onChange={event => { setEditingAddress(true); setAddress(event.target.value); }}
            onBlur={() => setEditingAddress(false)}
            onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setEditingAddress(false); setAddress(state.url || ""); event.currentTarget.blur(); } }}
            placeholder="localhost:3000"
            spellCheck={false}
            aria-label="Address"
          />
          {state.loading && <span className="workspace-browser__loading" aria-live="polite">Loading…</span>}
        </form>
        <div className="workspace-browser__actions">
          <button type="button" onClick={openExternally} disabled={!state.url} title="Open this address in your system browser" aria-label="Open in system browser">{chromeIcon("external")}</button>
          <button type="button" onClick={onClose} title="Close the browser" aria-label="Close the browser">{chromeIcon("close")}</button>
        </div>
      </header>
      {/* The reserved rectangle. Nothing is drawn inside it: the page is a
          native view positioned over exactly this box. The placeholder text
          below is what shows through before a page is loaded. */}
      <div className="workspace-browser__viewport" ref={viewportRef}>
        {!state.open && !state.url && (
          <div className="workspace-browser__empty">
            <strong>Nothing loaded yet</strong>
            <p>Open a service from the Services panel, or type a local address above. Mission Control previews addresses on this machine; anything else opens in your system browser.</p>
          </div>
        )}
      </div>
      {(notice || state.error) && (
        <p className="workspace-browser__notice" role="status">
          <span>{notice || state.error}</span>
          {state.url && <button type="button" onClick={openExternally}>Open in system browser</button>}
        </p>
      )}
    </section>
  );
}
