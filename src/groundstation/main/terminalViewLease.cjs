"use strict";

// Terminal View Lease Manager.
// Enforces that at most ONE presentation view (main window slot or detached pop-out window)
// holds write and resize authority over a worker's PTY at any moment.

class TerminalViewLeaseManager {
  /** @type {Map<string, object>} key = workerId */
  #leases = new Map();

  acquireLease(workerId, viewInfo = {}) {
    if (!workerId) throw new Error("workerId is required to acquire view lease");

    const current = this.#leases.get(workerId);
    const leaseVersion = current ? current.leaseVersion + 1 : 1;

    const lease = {
      workerId,
      workerRunId: viewInfo.workerRunId || "run-1",
      windowId: viewInfo.windowId || "main",
      slotId: viewInfo.slotId || null,
      detachedSlot: viewInfo.detachedSlot || null, // 1 | 2 | 3 | null
      state: viewInfo.detachedSlot ? "detached" : "docked",
      leaseVersion,
      acquiredAt: Date.now()
    };

    this.#leases.set(workerId, lease);
    return lease;
  }

  releaseLease(workerId, windowId) {
    const current = this.#leases.get(workerId);
    if (!current) return;
    if (current.windowId === windowId) {
      // Revert to docked main window
      this.#leases.set(workerId, {
        workerId,
        workerRunId: current.workerRunId,
        windowId: "main",
        slotId: current.slotId,
        detachedSlot: null,
        state: "docked",
        leaseVersion: current.leaseVersion + 1,
        acquiredAt: Date.now()
      });
    }
  }

  getLease(workerId) {
    return this.#leases.get(workerId) || null;
  }

  isAuthorized(workerId, windowId, leaseVersion = null) {
    const lease = this.#leases.get(workerId);
    if (!lease) return true; // Default allow if unmanaged
    if (lease.windowId !== windowId) return false;
    if (leaseVersion !== null && lease.leaseVersion !== leaseVersion) return false;
    return true;
  }
}

const terminalViewLeaseManager = new TerminalViewLeaseManager();

module.exports = {
  TerminalViewLeaseManager,
  terminalViewLeaseManager
};
