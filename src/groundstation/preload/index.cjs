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

function setPendingBadge(count) {
  return ipcRenderer.invoke("mission-control:set-pending-badge", count);
}

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
  request,
  openExternal,
  setPendingBadge,
  setWindowChrome,
  subscribe
}));
