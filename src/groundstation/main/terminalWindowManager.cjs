"use strict";

// Detached terminal windows (at most three).
//
// A pop-out is a presentation move: the worker keeps running in the same
// engine, under the same run identity, and only the view that may write to it
// changes hands. This manager owns the BrowserWindow lifecycle and the slot
// identities; terminalViewLease.cjs owns which view holds write authority.

const { terminalViewLeaseManager } = require("./terminalViewLease.cjs");

const MAX_DETACHED_WINDOWS = 3;

// Identity is carried by number and name as well as colour, so the windows stay
// distinguishable without relying on colour vision.
const SLOT_IDENTITIES = {
  1: { slot: 1, color: "#60A5FA", label: "Slot 1", name: "Window 1" },
  2: { slot: 2, color: "#A78BFA", label: "Slot 2", name: "Window 2" },
  3: { slot: 3, color: "#2DD4BF", label: "Slot 3", name: "Window 3" }
};

const MIN_WINDOW_WIDTH = 480;
const MIN_WINDOW_HEIGHT = 320;
const DEFAULT_WINDOW_WIDTH = 860;
const DEFAULT_WINDOW_HEIGHT = 560;

class TerminalWindowManager {
  /** @type {Map<string, object>} workerId -> entry */
  #detached = new Map();
  /** @type {Set<number>} slot numbers currently in use */
  #usedSlots = new Set();
  /** @type {Set<string>} workers with an in-flight detach, so double clicks cannot race */
  #opening = new Set();
  /** @type {Set<Function>} */
  #listeners = new Set();
  #createWindow;
  #onRecalled;
  #leases;

  constructor(options = {}) {
    // Injectable so the manager is testable without an Electron display, and so
    // two managers cannot silently share one process-wide lease table.
    this.#createWindow = typeof options.createWindow === "function" ? options.createWindow : null;
    this.#onRecalled = typeof options.onRecalled === "function" ? options.onRecalled : null;
    this.#leases = options.leases || terminalViewLeaseManager;
  }

  get leases() {
    return this.#leases;
  }

  get count() {
    return this.#detached.size;
  }

  get maxWindows() {
    return MAX_DETACHED_WINDOWS;
  }

  isDetached(workerId) {
    return this.#detached.has(workerId);
  }

  canDetach() {
    return this.#detached.size + this.#opening.size < MAX_DETACHED_WINDOWS;
  }

  #describe(workerId, entry) {
    return {
      workerId,
      workerName: entry.workerName,
      slotId: entry.slotId,
      detachedSlot: entry.detachedSlot,
      identity: SLOT_IDENTITIES[entry.detachedSlot],
      leaseVersion: entry.leaseVersion
    };
  }

  getDetachedInfo(workerId) {
    const entry = this.#detached.get(workerId);
    return entry ? this.#describe(workerId, entry) : null;
  }

  listDetached() {
    return Array.from(this.#detached.entries()).map(([workerId, entry]) => this.#describe(workerId, entry));
  }

  /**
   * The lease identity for a renderer. Anything that is not one of this
   * manager's pop-out windows is the docked main view.
   */
  viewIdForWebContents(webContentsId) {
    if (webContentsId === null || webContentsId === undefined) return "main";
    for (const entry of this.#detached.values()) {
      if (entry.webContentsId === webContentsId) return entry.windowId;
    }
    return "main";
  }

  #claimSlot() {
    for (let slot = 1; slot <= MAX_DETACHED_WINDOWS; slot += 1) {
      if (!this.#usedSlots.has(slot)) {
        this.#usedSlots.add(slot);
        return slot;
      }
    }
    return null;
  }

  /**
   * Move a worker's view into its own window. The slot is reserved before any
   * await so two clicks cannot both pass the limit check; a failure rolls the
   * reservation back and leaves the docked pane usable.
   */
  async detach(workerId, options = {}) {
    if (!workerId) throw new Error("workerId is required");
    if (this.#detached.has(workerId)) {
      // Asking twice focuses the window that already exists.
      this.focus(workerId);
      return this.getDetachedInfo(workerId);
    }
    if (this.#opening.has(workerId)) {
      throw new Error("That terminal is already opening in its own window.");
    }
    const assignedSlot = this.canDetach() ? this.#claimSlot() : null;
    if (assignedSlot === null) {
      throw new Error("Three terminals are already popped out. Recall one to open another.");
    }
    this.#opening.add(workerId);

    const workerName = options.workerName || workerId;
    const slotId = options.slotId || null;
    const windowId = `popout-${assignedSlot}-${workerId}`;

    let window = null;
    try {
      if (this.#createWindow) {
        window = await this.#createWindow({
          workerId,
          workerName,
          detachedSlot: assignedSlot,
          identity: SLOT_IDENTITIES[assignedSlot],
          windowId,
          minWidth: MIN_WINDOW_WIDTH,
          minHeight: MIN_WINDOW_HEIGHT,
          width: DEFAULT_WINDOW_WIDTH,
          height: DEFAULT_WINDOW_HEIGHT
        });
      }
    } catch (error) {
      this.#usedSlots.delete(assignedSlot);
      this.#opening.delete(workerId);
      throw error instanceof Error ? error : new Error(String(error));
    }

    // Write authority only moves once the new view exists. Until this point the
    // docked pane is still the sole writer, so a failed open changes nothing.
    const lease = this.#leases.acquireLease(workerId, {
      windowId,
      slotId,
      workerRunId: options.workerRunId,
      detachedSlot: assignedSlot
    });

    const entry = {
      workerId,
      workerName,
      slotId,
      detachedSlot: assignedSlot,
      windowId,
      leaseVersion: lease.leaseVersion,
      window,
      // Recorded so the IPC layer can tell which view a request came from and
      // enforce the lease on writes rather than trusting the renderer.
      webContentsId: window?.webContents?.id ?? null
    };
    this.#detached.set(workerId, entry);
    this.#opening.delete(workerId);

    // Closing the window (including Alt+F4) recalls the terminal rather than
    // stopping the worker. Stopping stays a separate, explicit action.
    if (window && typeof window.on === "function") {
      window.on("closed", () => {
        if (this.#detached.get(workerId) === entry) {
          this.#releaseEntry(workerId, entry, "window-closed");
        }
      });
    }

    const info = this.#describe(workerId, entry);
    this.#notify({ type: "terminal:detached", ...info });
    return info;
  }

  #releaseEntry(workerId, entry, reason) {
    this.#usedSlots.delete(entry.detachedSlot);
    this.#detached.delete(workerId);
    this.#leases.releaseLease(workerId, entry.windowId);
    const payload = {
      workerId,
      workerName: entry.workerName,
      slotId: entry.slotId,
      detachedSlot: entry.detachedSlot,
      reason
    };
    this.#notify({ type: "terminal:recalled", ...payload });
    try { this.#onRecalled?.(payload); } catch {}
  }

  async recall(workerId) {
    const entry = this.#detached.get(workerId);
    if (!entry) return false;
    this.#releaseEntry(workerId, entry, "recalled");
    const window = entry.window;
    if (window && typeof window.isDestroyed === "function" && !window.isDestroyed()) {
      try { window.destroy(); } catch {}
    }
    return true;
  }

  focus(workerId) {
    const entry = this.#detached.get(workerId);
    const window = entry?.window;
    if (!window || typeof window.focus !== "function") return false;
    if (typeof window.isDestroyed === "function" && window.isDestroyed()) return false;
    try {
      if (typeof window.isMinimized === "function" && window.isMinimized()) window.restore?.();
      window.show?.();
      window.focus();
      return true;
    } catch {
      return false;
    }
  }

  /** Recall every window — used when the project changes or the app shuts down. */
  async recallAll() {
    const ids = Array.from(this.#detached.keys());
    for (const workerId of ids) await this.recall(workerId);
    return ids.length;
  }

  subscribe(callback) {
    if (typeof callback !== "function") return () => {};
    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }

  #notify(event) {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // One bad observer must not stop the others.
      }
    }
  }
}

const terminalWindowManager = new TerminalWindowManager();

module.exports = {
  TerminalWindowManager,
  terminalWindowManager,
  SLOT_IDENTITIES,
  MAX_DETACHED_WINDOWS,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT
};
