"use strict";

// OUTARCH's own browser surface.
//
// A worker that starts a dev server advertises an address, and until now the
// only thing the app could do with that address was hand it to the operating
// system and lose the operator to another window. This mounts a real browser
// view inside the Groundstation window instead, positioned over a rectangle the
// renderer reserves for it.
//
// It is a `WebContentsView`, not a `<webview>`: the main window deliberately
// refuses `will-attach-webview`, and that hardening is not worth trading away.
// A view is a separate web contents with its own session partition, no preload,
// no Node, and a navigation policy of its own — so nothing about the renderer's
// privileges reaches the page being previewed.
//
// The policy is the same one `services.open` already states: loopback only.
// This is a previewer for services running on this machine, not a general
// browser. A navigation that would leave the machine is refused here and
// reported to the renderer, which offers the system browser instead.

const { WebContentsView } = require("electron");

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]", "::", "[::]"]);
const PARTITION = "persist:mission-control-browser";
// A reserved rectangle narrower than this is a layout accident, not a request.
const MIN_SIZE = 80;

function isLoopbackUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host) || LOOPBACK_HOSTS.has(`[${host}]`);
}

// The renderer reports the rectangle it cleared in CSS pixels, which are the
// same units a view's bounds use at zoom 1. Everything here is defensive: a
// renderer that reports a stale or absurd rectangle must not be able to park
// the view over the whole application or off the screen entirely.
function clampBounds(bounds, contentBounds) {
  const width = Math.round(Number(bounds?.width));
  const height = Math.round(Number(bounds?.height));
  const x = Math.round(Number(bounds?.x));
  const y = Math.round(Number(bounds?.y));
  if (![width, height, x, y].every(Number.isFinite)) return null;
  if (width < MIN_SIZE || height < MIN_SIZE) return null;
  const maxWidth = Math.max(MIN_SIZE, contentBounds.width);
  const maxHeight = Math.max(MIN_SIZE, contentBounds.height);
  const clampedX = Math.min(Math.max(0, x), Math.max(0, maxWidth - MIN_SIZE));
  const clampedY = Math.min(Math.max(0, y), Math.max(0, maxHeight - MIN_SIZE));
  return {
    x: clampedX,
    y: clampedY,
    width: Math.min(width, maxWidth - clampedX),
    height: Math.min(height, maxHeight - clampedY)
  };
}

class WorkspaceBrowser {
  #getWindow;
  #view;
  #bounds;
  #hidden;
  #url;
  #title;
  #loading;
  #error;
  #listeners;
  #disposed;

  constructor(options = {}) {
    this.#getWindow = typeof options.getWindow === "function" ? options.getWindow : () => null;
    this.#view = null;
    this.#bounds = null;
    this.#hidden = false;
    this.#url = "";
    this.#title = "";
    this.#loading = false;
    this.#error = null;
    this.#listeners = new Set();
    this.#disposed = false;
  }

  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit() {
    const event = { type: "workspace:browser", state: this.state() };
    for (const listener of this.#listeners) {
      try { listener(event); } catch { /* one observer must not starve the rest */ }
    }
  }

  state() {
    const contents = this.#view && !this.#view.webContents.isDestroyed() ? this.#view.webContents : null;
    return {
      available: true,
      open: Boolean(contents),
      url: this.#url,
      title: this.#title,
      loading: this.#loading,
      error: this.#error,
      canGoBack: Boolean(contents?.navigationHistory?.canGoBack?.()),
      canGoForward: Boolean(contents?.navigationHistory?.canGoForward?.())
    };
  }

  #host() {
    const window = this.#getWindow();
    return window && !window.isDestroyed() ? window : null;
  }

  #ensureView() {
    if (this.#view && !this.#view.webContents.isDestroyed()) return this.#view;
    const host = this.#host();
    if (!host) return null;

    const view = new WebContentsView({
      webPreferences: {
        // No preload, no Node, its own session: the page under preview shares
        // nothing with the renderer that asked for it.
        partition: PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: false,
        backgroundThrottling: true
      }
    });
    const contents = view.webContents;

    // A page cannot escape the loopback policy by navigating itself, and a
    // window it tries to open is refused rather than becoming a second surface
    // with no chrome around it.
    contents.setWindowOpenHandler(({ url }) => {
      if (isLoopbackUrl(url)) {
        this.#error = null;
        void contents.loadURL(url).catch(() => {});
      } else {
        this.#error = `${url} is not a local address. Use "Open in system browser".`;
        this.#emit();
      }
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (isLoopbackUrl(url)) return;
      event.preventDefault();
      this.#error = `${url} is not a local address. Use "Open in system browser".`;
      this.#emit();
    });
    contents.on("will-redirect", (event, url) => {
      if (isLoopbackUrl(url)) return;
      event.preventDefault();
      this.#error = `${url} is not a local address. Use "Open in system browser".`;
      this.#emit();
    });
    // Nothing in a previewed page may prompt for permissions the workspace
    // never asked for.
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

    contents.on("did-start-loading", () => { this.#loading = true; this.#emit(); });
    contents.on("did-stop-loading", () => {
      this.#loading = false;
      this.#url = contents.getURL() || this.#url;
      this.#emit();
    });
    contents.on("page-title-updated", (_event, title) => { this.#title = title; this.#emit(); });
    contents.on("did-fail-load", (_event, code, description, failingUrl, isMainFrame) => {
      // -3 is an aborted load, which is what a redirect refusal above looks
      // like from here; it has already been reported with a better message.
      if (!isMainFrame || code === -3) return;
      this.#loading = false;
      this.#error = `${description || "Could not load"} (${failingUrl || this.#url})`;
      this.#emit();
    });
    contents.on("render-process-gone", () => {
      this.#loading = false;
      this.#error = "The preview stopped responding. Reload to try again.";
      this.#emit();
    });

    host.contentView.addChildView(view);
    this.#view = view;
    // A view created before the renderer has reserved a rectangle stays at zero
    // size, which is what keeps a service opened from the Services panel from
    // flashing over the workspace before its tile exists.
    if (this.#bounds) view.setBounds(this.#bounds);
    view.setVisible?.(!this.#hidden && Boolean(this.#bounds));
    return view;
  }

  // Opening and navigating are the same operation from the renderer's side: it
  // has an address and a rectangle, and wants that address shown in it.
  open({ url, bounds } = {}) {
    if (this.#disposed) return this.state();
    if (bounds) this.setBounds(bounds, { silent: true });
    const view = this.#ensureView();
    if (!view) return this.state();
    if (url) {
      if (!isLoopbackUrl(url)) {
        this.#error = "Only local addresses can be previewed in OUTARCH.";
        this.#emit();
        return this.state();
      }
      this.#error = null;
      this.#url = String(url);
      this.#title = "";
      void view.webContents.loadURL(this.#url).catch(error => {
        this.#error = error instanceof Error ? error.message : String(error);
        this.#emit();
      });
    }
    this.#emit();
    return this.state();
  }

  // A native view does not stack with the DOM, so anything that must appear
  // over it — a modal, a menu — is announced here as `hidden` rather than being
  // fought with z-index, which cannot reach a view at all.
  setBounds(bounds, { silent = false } = {}) {
    const host = this.#host();
    if (!host) return this.state();
    const view = this.#view && !this.#view.webContents.isDestroyed() ? this.#view : null;
    if (bounds?.hidden === true) {
      this.#hidden = true;
      view?.setVisible?.(false);
      if (!silent) this.#emit();
      return this.state();
    }
    const clamped = clampBounds(bounds, host.getContentBounds());
    if (!clamped) return this.state();
    this.#bounds = clamped;
    this.#hidden = false;
    if (view) {
      view.setBounds(clamped);
      view.setVisible?.(true);
    }
    if (!silent) this.#emit();
    return this.state();
  }

  command(action) {
    const contents = this.#view && !this.#view.webContents.isDestroyed() ? this.#view.webContents : null;
    if (!contents) return this.state();
    const history = contents.navigationHistory;
    if (action === "back" && history?.canGoBack?.()) history.goBack();
    else if (action === "forward" && history?.canGoForward?.()) history.goForward();
    else if (action === "reload") { this.#error = null; contents.reload(); }
    else if (action === "stop") contents.stop();
    this.#emit();
    return this.state();
  }

  close() {
    const view = this.#view;
    this.#view = null;
    this.#loading = false;
    this.#error = null;
    if (view) {
      const host = this.#host();
      try { host?.contentView?.removeChildView?.(view); } catch { /* the window may already be gone */ }
      try { if (!view.webContents.isDestroyed()) view.webContents.close(); } catch { /* already closed */ }
    }
    this.#emit();
    return this.state();
  }

  dispose() {
    this.#disposed = true;
    this.close();
    this.#listeners.clear();
  }
}

module.exports = { WorkspaceBrowser, isLoopbackUrl, clampBounds, PARTITION };
