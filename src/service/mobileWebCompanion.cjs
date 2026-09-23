"use strict";

const fs = require("node:fs");
const path = require("node:path");

function getMobileManifestJson() {
  return JSON.stringify({
    name: "OUTARCH · Mobile Companion",
    short_name: "OUTARCH",
    description: "Encrypted mobile supervision and decision companion for OUTARCH",
    start_url: "/mobile",
    scope: "/mobile",
    display: "standalone",
    orientation: "portrait",
    background_color: "#000000",
    theme_color: "#000000",
    categories: ["utilities", "developer-tools", "productivity"],
    icons: [
      { src: "/mobile/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/mobile/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/mobile/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/mobile/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  }, null, 2);
}

function getMobileServiceWorkerJs() {
  return `"use strict";

const CACHE_NAME = "outarch-companion-v7";
const ASSETS_TO_CACHE = [
  "/mobile",
  "/mobile/",
  "/mobile/manifest.json",
  "/mobile/icon-192.png"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE).catch(() => {}))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.pathname === "/mobile" || url.pathname === "/mobile/") {
    event.respondWith(
      fetch(event.request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }
  if (url.pathname === "/mobile/manifest.json") {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
  }
});

self.addEventListener("push", event => {
  let payload = { title: "OUTARCH Alert", body: "New attention item or worker status update" };
  try {
    if (event.data) payload = event.data.json();
  } catch {}
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      vibrate: [200, 100, 200],
      tag: "mc-alert",
      renotify: true
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes("/mobile") && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow("/mobile");
    })
  );
});
`;
}

// The page itself lives in mobileWebCompanion.html: real HTML, CSS and
// script that an editor can read and check, instead of one long template
// string. It is read once and kept; a missing file serves a plain notice
// rather than taking the desktop's gateway down with it.
const PAGE_FILE = path.join(__dirname, "mobileWebCompanion.html");
let cachedPage = null;

function getMobileWebCompanionHtml() {
  if (cachedPage) return cachedPage;
  try {
    cachedPage = fs.readFileSync(PAGE_FILE, "utf8");
    return cachedPage;
  } catch {
    return "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>OUTARCH</title></head>"
      + "<body style=\"background:#000;color:#fafafa;font:16px system-ui;padding:32px\"><p>The OUTARCH companion page is missing from this installation. Reinstall OUTARCH on your computer.</p></body></html>";
  }
}

module.exports = { getMobileManifestJson, getMobileServiceWorkerJs, getMobileWebCompanionHtml };
