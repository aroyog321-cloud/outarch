const { contextBridge, ipcRenderer } = require("electron");

const PROTOCOL_VERSION = 1;
// Sandboxed Electron preload scripts can require Electron but not arbitrary
// local modules, so keep these stable wire-channel literals self-contained.
const REQUEST_CHANNEL = "mission-control:request";
const EVENT_CHANNEL = "mission-control:event";
const MAX_BUFFERED_EVENTS = 512;
let requestSequence = 0;
let bufferedEvents = [];
const subscribers = new Map();

function matchesEventFilter(message, filter) {
  if (!filter) return true;
  if (typeof filter === "string") {
    return message.type === filter || message.channel === filter;
  }
  if (Array.isArray(filter)) {
    return filter.includes(message.type) || filter.includes(message.channel);
  }
  if (typeof filter === "object") {
    if (filter.type && message.type !== filter.type) return false;
    if (Array.isArray(filter.types) && !filter.types.includes(message.type)) return false;
    if (filter.sessionId && message.sessionId !== filter.sessionId) return false;
    if (filter.channel && message.channel !== filter.channel) return false;
    if (filter.integration && message.integration !== filter.integration) return false;
    return true;
  }
  return true;
}

function request(method, params = {}) {
  const id = `renderer-${Date.now()}-${++requestSequence}`;
  return ipcRenderer.invoke(REQUEST_CHANNEL, {
    version: PROTOCOL_VERSION,
    id,
    method,
    params
  });
}

function subscribe(callback, filter = null) {
  if (typeof callback !== "function") throw new TypeError("subscribe requires a callback");
  subscribers.set(callback, filter);
  if (bufferedEvents.length) {
    const pending = bufferedEvents;
    bufferedEvents = [];
    for (const message of pending) {
      if (matchesEventFilter(message, filter)) {
        try { callback(message); } catch {}
      }
    }
  }
  return () => subscribers.delete(callback);
}

function openExternal(url) {
  return ipcRenderer.invoke("mission-control:open-external", url);
}

function setWindowChrome(mode) {
  return ipcRenderer.invoke("mission-control:set-window-chrome", mode);
}

// Copying happens in the main process, which does not need the window to be focused.
function copyText(text) {
  return ipcRenderer.invoke("mission-control:copy-text", String(text ?? ""));
}

function setPendingBadge(count) {
  return ipcRenderer.invoke("mission-control:set-pending-badge", count);
}

// The account and the updater answer on their own channels because both work
// before a project is open (the sign-in screen has no engine behind it). The
// renderer learns who is signed in and what their plan allows; never a token.
const ACCOUNT_CHANNEL = "mission-control:account";
const ACCOUNT_EVENT_CHANNEL = "mission-control:account-event";
const UPDATE_CHANNEL = "mission-control:update";
const UPDATE_EVENT_CHANNEL = "mission-control:update-event";
const accountListeners = new Set();
const updateListeners = new Set();

function listen(listeners, callback) {
  if (typeof callback !== "function") throw new TypeError("a listener must be a function");
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notify(listeners, payload) {
  for (const callback of listeners) {
    try { callback(payload); } catch { /* one listener must not starve the rest */ }
  }
}

ipcRenderer.on(ACCOUNT_EVENT_CHANNEL, (_event, status) => notify(accountListeners, status));
ipcRenderer.on(UPDATE_EVENT_CHANNEL, (_event, status) => notify(updateListeners, status));

const account = Object.freeze({
  status: () => ipcRenderer.invoke(ACCOUNT_CHANNEL, { action: "status" }),
  signIn: mode => ipcRenderer.invoke(ACCOUNT_CHANNEL, { action: "signIn", mode: mode === "signup" ? "signup" : "signin" }),
  cancelSignIn: () => ipcRenderer.invoke(ACCOUNT_CHANNEL, { action: "cancelSignIn" }),
  signOut: () => ipcRenderer.invoke(ACCOUNT_CHANNEL, { action: "signOut" }),
  refresh: () => ipcRenderer.invoke(ACCOUNT_CHANNEL, { action: "refresh" }),
  openPortal: (page, query) => ipcRenderer.invoke(ACCOUNT_CHANNEL, { action: "openPortal", page: page === "pricing" ? "pricing" : "account", query: query && typeof query === "object" ? { plan: query.plan, feature: query.feature } : {} }),
  onChange: callback => listen(accountListeners, callback)
});

const updates = Object.freeze({
  status: () => ipcRenderer.invoke(UPDATE_CHANNEL, { action: "status" }),
  check: () => ipcRenderer.invoke(UPDATE_CHANNEL, { action: "check" }),
  download: () => ipcRenderer.invoke(UPDATE_CHANNEL, { action: "download" }),
  install: () => ipcRenderer.invoke(UPDATE_CHANNEL, { action: "install" }),
  onChange: callback => listen(updateListeners, callback)
});

ipcRenderer.on(EVENT_CHANNEL, (_event, message) => {
  if (!message || message.version !== PROTOCOL_VERSION) return;
  if (!subscribers.size) {
    bufferedEvents.push(message);
    if (bufferedEvents.length > MAX_BUFFERED_EVENTS) {
      bufferedEvents = bufferedEvents.slice(-MAX_BUFFERED_EVENTS);
    }
    return;
  }
  for (const [callback, filter] of subscribers) {
    if (matchesEventFilter(message, filter)) {
      try {
        callback(message);
      } catch (error) {
        // A renderer observer must not starve other observers.
      }
    }
  }
});

contextBridge.exposeInMainWorld("missionControl", Object.freeze({
  version: PROTOCOL_VERSION,
  account,
  updates,
  request,
  copyText,
  openExternal,
  setPendingBadge,
  setWindowChrome,
  subscribe
}));
