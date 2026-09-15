"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { TerminalWindowManager, MAX_DETACHED_WINDOWS } = require("../src/groundstation/main/terminalWindowManager.cjs");
const { TerminalViewLeaseManager } = require("../src/groundstation/main/terminalViewLease.cjs");

// A stand-in for the BrowserWindow the manager is given in the desktop app, so
// slot allocation and lifecycle can be exercised without a display.
function fakeWindowFactory(created = []) {
  return async spec => {
    const listeners = new Map();
    const window = {
      spec,
      destroyed: false,
      focused: 0,
      on: (event, handler) => listeners.set(event, handler),
      emit: event => listeners.get(event)?.(),
      isDestroyed: () => window.destroyed,
      destroy: () => { window.destroyed = true; },
      focus: () => { window.focused += 1; },
      show: () => {},
      isMinimized: () => false
    };
    created.push(window);
    return window;
  };
}

test("TerminalWindowManager detaches terminals up to the 3-window ceiling with distinct slots", async () => {
  const created = [];
  const manager = new TerminalWindowManager({ leases: new TerminalViewLeaseManager(), createWindow: fakeWindowFactory(created) });

  const term1 = await manager.detach("w1", { slotId: "slot-0", workerName: "Storefront" });
  assert.equal(term1.detachedSlot, 1);
  assert.equal(term1.identity.color, "#60A5FA");
  assert.equal(term1.workerName, "Storefront");

  const term2 = await manager.detach("w2", { slotId: "slot-1", workerName: "API" });
  assert.equal(term2.detachedSlot, 2);
  assert.equal(term2.identity.color, "#A78BFA");

  const term3 = await manager.detach("w3", { slotId: "slot-2", workerName: "Database" });
  assert.equal(term3.detachedSlot, 3);
  assert.equal(term3.identity.color, "#2DD4BF");
  assert.equal(manager.count, MAX_DETACHED_WINDOWS);
  assert.equal(manager.canDetach(), false);

  await assert.rejects(
    () => manager.detach("w4", { slotId: "slot-3", workerName: "Extra" }),
    /Three terminals are already popped out/
  );
  // The rejected fourth request must not have created a window.
  assert.equal(created.length, 3);

  await manager.recall("w2");
  assert.equal(manager.count, 2);
  assert.equal(created[1].destroyed, true);

  const term4 = await manager.detach("w4", { slotId: "slot-1", workerName: "Worker 4" });
  assert.equal(term4.detachedSlot, 2, "the freed slot is reused");
});

test("detaching the same worker twice focuses the existing window instead of opening another", async () => {
  const created = [];
  const manager = new TerminalWindowManager({ leases: new TerminalViewLeaseManager(), createWindow: fakeWindowFactory(created) });

  const first = await manager.detach("w1", { workerName: "Storefront" });
  const again = await manager.detach("w1", { workerName: "Storefront" });

  assert.equal(created.length, 1);
  assert.equal(again.detachedSlot, first.detachedSlot);
  assert.equal(created[0].focused, 1);
});

test("a window that fails to open rolls its slot back and leaves the docked pane usable", async () => {
  const leases = new TerminalViewLeaseManager();
  const manager = new TerminalWindowManager({
    leases,
    createWindow: async () => { throw new Error("display unavailable"); }
  });

  await assert.rejects(() => manager.detach("w1", { workerName: "Storefront" }), /display unavailable/);
  assert.equal(manager.count, 0);
  assert.equal(manager.canDetach(), true);
  assert.equal(manager.isDetached("w1"), false);
  // Write authority never left the docked view.
  assert.equal(leases.isAuthorized("w1", "main"), true);
});

test("write authority moves to the pop-out and returns to the docked pane on recall", async () => {
  const leases = new TerminalViewLeaseManager();
  const manager = new TerminalWindowManager({ leases, createWindow: fakeWindowFactory() });

  const info = await manager.detach("w1", { slotId: "slot-0", workerName: "Storefront" });
  assert.equal(leases.isAuthorized("w1", "main"), false, "the docked pane loses write authority");
  assert.equal(leases.isAuthorized("w1", "popout-1-w1", info.leaseVersion), true);

  await manager.recall("w1");
  assert.equal(leases.isAuthorized("w1", "main"), true, "recall returns write authority to the docked pane");
});

test("closing a pop-out window recalls the terminal rather than stopping the worker", async () => {
  const created = [];
  const recalled = [];
  const manager = new TerminalWindowManager({
    leases: new TerminalViewLeaseManager(),
    createWindow: fakeWindowFactory(created),
    onRecalled: payload => recalled.push(payload)
  });

  await manager.detach("w1", { slotId: "slot-0", workerName: "Storefront" });
  created[0].emit("closed");

  assert.equal(manager.count, 0);
  assert.equal(recalled.length, 1);
  assert.equal(recalled[0].reason, "window-closed");
  assert.equal(recalled[0].slotId, "slot-0", "the reserved pane is named so the view can return to it");
});

test("recallAll returns every detached terminal", async () => {
  const manager = new TerminalWindowManager({ leases: new TerminalViewLeaseManager(), createWindow: fakeWindowFactory() });
  await manager.detach("w1", { workerName: "One" });
  await manager.detach("w2", { workerName: "Two" });

  assert.equal(await manager.recallAll(), 2);
  assert.equal(manager.count, 0);
  assert.deepEqual(manager.listDetached(), []);
});

test("TerminalViewLeaseManager tracks single writer lease authority", () => {
  const leases = new TerminalViewLeaseManager();
  const lease = leases.acquireLease("w1", { windowId: "popout-1", slotId: "slot-0", detachedSlot: 1 });
  assert.equal(lease.state, "detached");
  assert.equal(leases.isAuthorized("w1", "popout-1", lease.leaseVersion), true);
  assert.equal(leases.isAuthorized("w1", "main"), false);

  // A stale acknowledgement from a view that lost the handoff is refused.
  assert.equal(leases.isAuthorized("w1", "popout-1", lease.leaseVersion - 1), false);

  leases.releaseLease("w1", "popout-1");
  assert.equal(leases.isAuthorized("w1", "main"), true);
});
