"use strict";

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

const CACHE_NAME = "outarch-companion-v5";
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

function getMobileWebCompanionHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="theme-color" content="#000000">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="OUTARCH">
  <link rel="manifest" href="/mobile/manifest.json">
  <link rel="icon" type="image/png" href="/mobile/icon-192.png">
  <link rel="apple-touch-icon" href="/mobile/apple-touch-icon.png">
  <title>OUTARCH · Mobile Companion</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #07090e;
      --bg-gradient: radial-gradient(circle at 50% 0%, rgba(56, 189, 248, 0.12), transparent 45%),
                     radial-gradient(circle at 100% 100%, rgba(99, 102, 241, 0.08), transparent 40%),
                     linear-gradient(180deg, #07090e 0%, #0c1017 100%);
      --surface: rgba(15, 20, 30, 0.78);
      --surface-card: rgba(20, 27, 40, 0.65);
      --surface-subtle: rgba(255, 255, 255, 0.03);
      --surface-hover: rgba(255, 255, 255, 0.06);
      --surface-active: rgba(255, 255, 255, 0.09);
      --border: rgba(255, 255, 255, 0.08);
      --border-highlight: rgba(56, 189, 248, 0.35);
      --border-glow: rgba(56, 189, 248, 0.25);
      
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      
      --primary: #38bdf8;
      --primary-gradient: linear-gradient(135deg, #0284c7 0%, #2563eb 100%);
      --primary-glow: rgba(56, 189, 248, 0.3);
      
      --ok: #34d399;
      --ok-soft: rgba(52, 211, 153, 0.12);
      --ok-border: rgba(52, 211, 153, 0.3);
      --ok-glow: rgba(52, 211, 153, 0.25);
      
      --warn: #fbbf24;
      --warn-soft: rgba(251, 191, 36, 0.12);
      --warn-border: rgba(251, 191, 36, 0.35);
      --warn-glow: rgba(251, 191, 36, 0.3);
      
      --danger: #f87171;
      --danger-soft: rgba(248, 113, 113, 0.12);
      --danger-border: rgba(248, 113, 113, 0.35);
      --danger-glow: rgba(248, 113, 113, 0.3);
      
      --purple: #a78bfa;
      --purple-soft: rgba(167, 139, 250, 0.12);
      --purple-border: rgba(167, 139, 250, 0.3);

      --font-sans: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      
      --nav-height: 66px;
      --header-height: 60px;
      --radius-sm: 10px;
      --radius-md: 14px;
      --radius-lg: 18px;
      --radius-xl: 24px;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
    }

    input, textarea {
      user-select: text;
    }

    html, body {
      background: var(--bg);
      background-image: var(--bg-gradient);
      background-attachment: fixed;
      color: var(--text);
      font-family: var(--font-sans);
      font-size: 14px;
      line-height: 1.5;
      min-height: 100vh;
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
    }

    body {
      display: flex;
      flex-direction: column;
      padding-bottom: calc(var(--nav-height) + env(safe-area-inset-bottom, 20px) + 20px);
    }

    /* Glassmorphism Header */
    header {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: max(12px, env(safe-area-inset-top, 12px)) 18px 12px;
      background: rgba(7, 9, 14, 0.85);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border-bottom: 1px solid var(--border);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      cursor: pointer;
    }

    .brand-mark {
      display: block;
      width: 38px;
      height: 38px;
      background: #000;
      border: 1px solid var(--border);
      border-radius: 10px;
      flex-shrink: 0;
    }

    .brand-title { min-width: 0; }
    .brand-title strong {
      display: block;
      font-size: 14.5px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #fff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .brand-title small {
      display: block;
      font-size: 11.5px;
      color: var(--text-dim);
      font-family: var(--font-mono);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 700;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      cursor: pointer;
      transition: all 150ms ease;
    }
    .status-badge:active { transform: scale(0.96); }

    .status-badge i {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 10px currentColor;
    }

    .status-badge.is-live {
      color: var(--ok);
      background: var(--ok-soft);
      border-color: var(--ok-border);
      box-shadow: 0 0 14px var(--ok-glow);
    }
    .status-badge.is-live i {
      animation: pulseLive 2s infinite ease-in-out;
    }

    @keyframes pulseLive {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.4); opacity: 0.6; }
    }

    .status-badge.is-offline { color: var(--text-dim); background: rgba(255, 255, 255, 0.03); }
    .status-badge.is-waiting {
      color: var(--warn);
      background: var(--warn-soft);
      border-color: var(--warn-border);
      box-shadow: 0 0 14px var(--warn-glow);
    }

    .icon-btn {
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.04);
      color: var(--text-muted);
      cursor: pointer;
      position: relative;
      transition: all 150ms ease;
    }
    .icon-btn:active { background: rgba(255, 255, 255, 0.12); color: #fff; transform: scale(0.94); }
    .icon-btn .badge-dot {
      position: absolute;
      top: 7px;
      right: 7px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--danger);
      box-shadow: 0 0 10px var(--danger);
      animation: pulseAlert 1.5s infinite;
    }

    @keyframes pulseAlert {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.3); }
    }

    /* Main Container */
    main {
      flex: 1;
      padding: 16px 16px 8px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      max-width: 620px;
      width: 100%;
      margin: 0 auto;
    }

    /* PWA Install Banner */
    .pwa-banner {
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-radius: var(--radius-md);
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.16), rgba(99, 102, 241, 0.1));
      border: 1px solid rgba(56, 189, 248, 0.35);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
      animation: fadeIn 200ms ease;
    }
    .pwa-banner.is-visible { display: flex; }
    .pwa-banner-text strong { display: block; font-size: 13px; font-weight: 750; color: #fff; }
    .pwa-banner-text small { display: block; font-size: 11px; color: var(--text-muted); }
    .btn-install {
      padding: 7px 14px;
      border-radius: var(--radius-sm);
      font-size: 12px;
      font-weight: 750;
      background: var(--primary);
      color: #07090e;
      border: none;
      cursor: pointer;
      white-space: nowrap;
      box-shadow: 0 2px 12px rgba(56, 189, 248, 0.4);
      transition: transform 120ms ease;
    }
    .btn-install:active { transform: scale(0.95); }

    /* Toast Container */
    .toast-container {
      position: fixed;
      top: calc(var(--header-height) + env(safe-area-inset-top, 12px) + 10px);
      left: 16px;
      right: 16px;
      z-index: 300;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      padding: 13px 16px;
      border-radius: var(--radius-md);
      background: rgba(15, 20, 30, 0.95);
      border: 1px solid var(--border);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      animation: slideDown 240ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .toast.alert-critical { border-color: var(--danger-border); background: rgba(30, 15, 20, 0.96); color: #fca5a5; }
    .toast.alert-warning { border-color: var(--warn-border); background: rgba(32, 24, 12, 0.96); color: #fde68a; }
    .toast.alert-success { border-color: var(--ok-border); background: rgba(14, 30, 22, 0.96); color: #86efac; }

    @keyframes slideDown {
      from { transform: translateY(-20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    /* Cards */
    .card {
      background: var(--surface);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 18px;
      box-shadow: 0 6px 28px rgba(0, 0, 0, 0.45), inset 0 1px 0 0 rgba(255, 255, 255, 0.06);
      position: relative;
    }

    .card-title {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-dim);
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .card-title span.badge {
      font-size: 10px;
      font-weight: 750;
      padding: 3px 8px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-muted);
      border: 1px solid var(--border);
      /* A project name can be long; it stays one line beside the title. */
      max-width: 55%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* System Health Header in Cockpit */
    .system-health-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 14px 16px;
      border-radius: var(--radius-md);
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border);
      margin-bottom: 12px;
    }
    .system-health-status {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .system-health-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--ok);
      box-shadow: 0 0 14px var(--ok-glow);
    }
    .system-health-dot.is-warn { background: var(--warn); box-shadow: 0 0 14px var(--warn-glow); }
    .system-health-dot.is-danger { background: var(--danger); box-shadow: 0 0 14px var(--danger-glow); }
    .system-health-title strong { display: block; font-size: 13.5px; font-weight: 750; }
    .system-health-title small { display: block; font-size: 11px; color: var(--text-dim); }

    /* Telemetry Grid */
    .telemetry-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }
    .telemetry-tile {
      background: var(--surface-subtle);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      cursor: pointer;
      transition: all 140ms ease;
    }
    .telemetry-tile:active {
      background: var(--surface-hover);
      transform: scale(0.98);
      border-color: rgba(255, 255, 255, 0.14);
    }
    .telemetry-tile b {
      font-size: 26px;
      font-weight: 850;
      line-height: 1.1;
      letter-spacing: -0.03em;
      font-family: var(--font-mono);
    }
    .telemetry-tile small {
      font-size: 10.5px;
      font-weight: 750;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-dim);
    }

    /* Filter Bar */
    .filter-bar {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 2px;
      scrollbar-width: none;
    }
    .filter-bar::-webkit-scrollbar { display: none; }
    .filter-chip {
      padding: 6px 13px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 700;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      color: var(--text-muted);
      cursor: pointer;
      white-space: nowrap;
      transition: all 120ms ease;
    }
    .filter-chip:active { transform: scale(0.96); }
    .filter-chip.is-active {
      background: rgba(56, 189, 248, 0.16);
      border-color: rgba(56, 189, 248, 0.45);
      color: var(--primary);
      box-shadow: 0 0 14px rgba(56, 189, 248, 0.2);
    }

    /* Search Box */
    .search-box {
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 0 14px;
      transition: border-color 150ms ease;
    }
    .search-box:focus-within {
      border-color: var(--primary);
      box-shadow: 0 0 16px rgba(56, 189, 248, 0.25);
    }
    .search-box svg { color: var(--text-dim); flex-shrink: 0; }
    .search-box input {
      flex: 1;
      background: transparent;
      border: none;
      color: #fff;
      font-size: 13.5px;
      padding: 12px 0;
      outline: none;
      font-family: inherit;
    }
    .search-box input::placeholder { color: var(--text-dim); }

    /* Lists and Rows */
    .item-list { display: flex; flex-direction: column; gap: 10px; }
    .item-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px;
      background: var(--surface-subtle);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      transition: all 140ms ease;
    }
    .item-row:active { background: var(--surface-hover); }
    .item-info { min-width: 0; flex: 1; }
    .item-info strong {
      display: block;
      font-size: 13.5px;
      font-weight: 750;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .item-info small {
      display: block;
      font-size: 11px;
      color: var(--text-dim);
      font-family: var(--font-mono);
      margin-top: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 750;
      white-space: nowrap;
      letter-spacing: 0.02em;
    }
    .pill i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .pill.running { color: var(--ok); background: var(--ok-soft); border: 1px solid var(--ok-border); }
    .pill.idle { color: var(--text-muted); background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border); }
    .pill.critical { color: var(--danger); background: var(--danger-soft); border: 1px solid var(--danger-border); }
    .pill.warning { color: var(--warn); background: var(--warn-soft); border: 1px solid var(--warn-border); }

    /* Action Buttons */
    .action-btn {
      padding: 8px 14px;
      font-size: 12px;
      font-weight: 750;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-muted);
      cursor: pointer;
      white-space: nowrap;
      transition: all 120ms ease;
    }
    .action-btn:active { background: rgba(255, 255, 255, 0.12); color: #fff; transform: scale(0.96); }
    .action-btn.primary {
      background: var(--primary-gradient);
      border-color: rgba(255, 255, 255, 0.2);
      color: #fff;
      box-shadow: 0 2px 12px rgba(37, 99, 235, 0.35);
    }
    .action-btn.danger { color: var(--danger); border-color: var(--danger-border); background: var(--danger-soft); }
    .action-btn.warn { color: var(--warn); border-color: var(--warn-border); background: var(--warn-soft); }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 14px 20px;
      background: var(--primary-gradient);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: var(--radius-md);
      color: #fff;
      font-size: 14.5px;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 4px 18px rgba(37, 99, 235, 0.4);
      transition: all 140ms ease;
    }
    .btn:active { transform: scale(0.98); opacity: 0.92; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.04);
      border-color: var(--border);
      box-shadow: none;
      color: var(--text-muted);
    }
    .btn-secondary:hover, .btn-secondary:active {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
    }

    /* Pairing Form & Hero */
    .card.pair-form {
      display: flex;
      flex-direction: column;
      gap: 18px;
      background: rgba(14, 18, 28, 0.82);
      backdrop-filter: blur(28px) saturate(180%);
      -webkit-backdrop-filter: blur(28px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 24px;
      padding: 26px 22px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.08);
      margin-top: 4px;
    }
    .pair-hero {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 4px 0 2px;
    }
    .pair-shield-icon {
      width: 58px;
      height: 58px;
      border-radius: 16px;
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.15) 0%, rgba(168, 85, 247, 0.15) 100%);
      border: 1px solid rgba(56, 189, 248, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--primary);
      box-shadow: 0 0 24px rgba(56, 189, 248, 0.25);
      margin-bottom: 12px;
    }
    .pair-hero h2 {
      font-size: 20px;
      font-weight: 800;
      color: #fff;
      margin-bottom: 6px;
      letter-spacing: -0.02em;
    }
    .pair-hero p {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.45;
      max-width: 380px;
    }
    .input-group { display: flex; flex-direction: column; gap: 8px; }
    .input-group label { font-size: 11.5px; font-weight: 750; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
    .input-group input, .input-group textarea {
      width: 100%;
      padding: 14px 16px;
      background: rgba(0, 0, 0, 0.45);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      color: #fff;
      font-size: 15px;
      font-family: inherit;
      outline: none;
      transition: all 180ms ease;
    }
    .input-group input:focus, .input-group textarea:focus {
      border-color: var(--primary);
      box-shadow: 0 0 18px rgba(56, 189, 248, 0.3);
    }
    .notice-box {
      padding: 8px 14px;
      border-radius: 999px;
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.25);
      font-size: 11.5px;
      font-family: var(--font-mono);
      font-weight: 600;
      color: #34d399;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin: 0 auto;
    }
    .notice-box i {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
      flex-shrink: 0;
      display: inline-block;
    }

    /* 6-Digit Segmented OTP PIN Slots */
    .pin-input-wrap {
      position: relative;
      margin-top: 2px;
    }
    .pin-slots-row {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 8px;
      position: relative;
      cursor: text;
    }
    .pin-slot {
      background: rgba(0, 0, 0, 0.55);
      border: 1.5px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-mono);
      font-size: 24px;
      font-weight: 800;
      color: #fff;
      transition: all 180ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .pin-slot.is-focused {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.25), 0 0 16px rgba(56, 189, 248, 0.2);
      background: rgba(56, 189, 248, 0.06);
    }
    .pin-slot.is-filled {
      border-color: rgba(255, 255, 255, 0.35);
      background: rgba(255, 255, 255, 0.04);
      color: var(--primary);
    }
    .pin-slot.is-error {
      border-color: var(--danger);
      box-shadow: 0 0 0 3px var(--danger-soft);
      animation: pinShake 0.35s ease-in-out;
    }
    @keyframes pinShake {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-4px); }
      40%, 80% { transform: translateX(4px); }
    }
    .pin-caret {
      width: 2px;
      height: 24px;
      background: var(--primary);
      animation: blinkCaret 1s infinite;
      display: inline-block;
    }
    @keyframes blinkCaret {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
    .invisible-otp-input {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      z-index: 10;
      cursor: text;
      font-size: 20px;
    }

    /* Device Card Inset */
    .device-card-wrap {
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 12px;
      transition: border-color 150ms ease;
    }
    .device-card-wrap:focus-within {
      border-color: var(--primary);
      box-shadow: 0 0 16px rgba(56, 189, 248, 0.25);
    }
    .device-card-icon {
      width: 36px;
      height: 36px;
      border-radius: 9px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      display: grid;
      place-items: center;
      color: var(--primary);
      flex-shrink: 0;
    }
    .device-card-meta {
      flex: 1;
      min-width: 0;
    }
    .device-card-meta label {
      display: block;
      font-size: 10px;
      font-weight: 800;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.07em;
      margin-bottom: 2px;
    }
    .device-card-meta input {
      width: 100%;
      background: transparent;
      border: none;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      font-family: inherit;
      outline: none;
      padding: 0;
    }

    /* Handshake Timeline */
    .handshake-timeline {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 12px 14px;
      display: none;
      flex-direction: column;
      gap: 8px;
    }
    .handshake-step {
      display: flex;
      align-items: center;
      gap: 9px;
      font-size: 11.5px;
      font-family: var(--font-mono);
      color: var(--text-muted);
    }
    .handshake-step.done {
      color: #86efac;
    }
    .handshake-step.active {
      color: var(--primary);
    }
    .step-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #334155;
      flex-shrink: 0;
    }
    .step-dot.active {
      background: var(--primary);
      box-shadow: 0 0 8px var(--primary);
      animation: pulseLive 1s infinite;
    }
    .step-dot.done {
      background: var(--ok);
      box-shadow: 0 0 6px var(--ok);
    }

    /* Authorize Button */
    .btn-pair-primary {
      width: 100%;
      height: 48px;
      font-size: 14.5px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: var(--primary-gradient);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: var(--radius-md);
      color: #fff;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(37, 99, 235, 0.4);
      transition: all 180ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .btn-pair-primary:hover {
      filter: brightness(1.08);
      box-shadow: 0 6px 26px rgba(56, 189, 248, 0.45);
      transform: translateY(-1px);
    }
    .btn-pair-primary:active {
      transform: scale(0.98);
    }
    .btn-pair-primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .msg {
      font-size: 12.5px;
      text-align: center;
      color: var(--text-muted);
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      display: none;
      line-height: 1.4;
    }
    .msg:not(:empty) {
      display: block;
    }
    .msg.error {
      color: #fca5a5;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid rgba(248, 113, 113, 0.3);
    }
    .msg.success {
      color: #86efac;
      background: rgba(52, 211, 153, 0.1);
      border: 1px solid rgba(52, 211, 153, 0.3);
    }
    .msg.info {
      color: #7dd3fc;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.3);
    }

    /* Desktop Navigation Tabs */
    .desktop-nav {
      display: none;
      align-items: center;
      gap: 5px;
      background: rgba(0, 0, 0, 0.45);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 4px;
    }
    .desktop-nav-tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 999px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--text-muted);
      font-family: var(--font-sans);
      font-size: 12.5px;
      font-weight: 700;
      cursor: pointer;
      position: relative;
      transition: all 140ms ease;
    }
    .desktop-nav-tab svg {
      width: 15px;
      height: 15px;
      stroke: currentColor;
      fill: none;
      stroke-width: 2.2;
    }
    .desktop-nav-tab:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.06);
    }
    .desktop-nav-tab.is-active {
      color: #fff;
      background: var(--surface-active);
      border-color: var(--border-medium);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4), 0 0 12px rgba(56, 189, 248, 0.2);
    }
    .desktop-nav-tab.is-active svg {
      color: var(--primary);
    }
    .desktop-nav-badge {
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 800;
      background: var(--danger);
      color: #fff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 8px var(--danger);
    }

    /* Ask Mission AI */
    .ask { display: flex; flex-direction: column; gap: 12px; padding-bottom: 84px; }
    .ask-thread { display: flex; flex-direction: column; gap: 10px; }
    .ask-empty { padding: 20px 18px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); }
    .ask-empty strong { display: block; color: var(--text); font-size: 15px; }
    .ask-empty p { margin-top: 4px; color: var(--text-muted); font-size: 13px; line-height: 1.5; }
    .ask-suggestions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    .ask-suggestions button { padding: 8px 12px; color: var(--text); background: var(--surface-subtle); border: 1px solid var(--border); border-radius: 999px; font: inherit; font-size: 12.5px; }
    .ask-msg { max-width: 92%; padding: 11px 14px; border-radius: var(--radius-md); font-size: 14px; line-height: 1.55; overflow-wrap: anywhere; }
    .ask-msg--user { align-self: flex-end; color: var(--text); background: rgba(56, 189, 248, 0.14); border: 1px solid rgba(56, 189, 248, 0.28); white-space: pre-wrap; }
    .ask-msg--ai { align-self: flex-start; color: var(--text); background: var(--surface); border: 1px solid var(--border); }
    .ask-msg--ai p + p, .ask-msg--ai p + ul, .ask-msg--ai ul + p, .ask-msg--ai pre + p, .ask-msg--ai p + pre { margin-top: 8px; }
    .ask-msg--ai ul { padding-left: 18px; }
    .ask-msg--ai li + li { margin-top: 3px; }
    .ask-msg--ai code { padding: 1px 5px; font-family: var(--font-mono); font-size: 12.5px; background: rgba(255, 255, 255, 0.07); border-radius: 5px; }
    .ask-code { margin: 0; padding: 10px 12px; overflow-x: auto; font-family: var(--font-mono); font-size: 12px; line-height: 1.5; white-space: pre; background: rgba(0, 0, 0, 0.45); border: 1px solid var(--border); border-radius: var(--radius-sm); }
    .ask-meta { display: block; margin-top: 8px; color: var(--text-dim); font-size: 11.5px; }
    .ask-error { color: var(--danger); }
    .ask-msg--busy { display: flex; align-items: center; gap: 10px; color: var(--text-muted); }
    .ask-dots { display: inline-flex; gap: 4px; }
    .ask-dots i { width: 6px; height: 6px; background: var(--text-muted); border-radius: 50%; animation: askPulse 1.2s infinite ease-in-out; }
    .ask-dots i:nth-child(2) { animation-delay: .15s; }
    .ask-dots i:nth-child(3) { animation-delay: .3s; }
    @keyframes askPulse { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
    .ask-composer {
      position: fixed;
      left: 12px;
      right: 12px;
      bottom: calc(var(--nav-height) + env(safe-area-inset-bottom, 20px) + 10px);
      z-index: 140;
      display: flex;
      align-items: flex-end;
      gap: 8px;
      padding: 8px;
      background: rgba(12, 16, 24, 0.94);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    }
    .ask-composer textarea { flex: 1; min-height: 40px; max-height: 120px; padding: 10px 12px; color: var(--text); background: transparent; border: 0; outline: none; resize: none; font: inherit; font-size: 15px; }
    .ask-composer .action-btn { min-height: 40px; padding: 0 16px; }
    .ask-composer .action-btn:disabled { opacity: .5; }
    @media (prefers-reduced-motion: reduce) { .ask-dots i { animation: none; opacity: .7; } }
    nav.bottom-nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: calc(var(--nav-height) + env(safe-area-inset-bottom, 20px));
      padding-bottom: env(safe-area-inset-bottom, 20px);
      background: rgba(7, 9, 14, 0.88);
      backdrop-filter: blur(28px) saturate(180%);
      -webkit-backdrop-filter: blur(28px) saturate(180%);
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-around;
      z-index: 150;
    }
    .nav-tab {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      flex: 1;
      height: 100%;
      color: var(--text-dim);
      font-size: 10.5px;
      font-weight: 750;
      cursor: pointer;
      position: relative;
      transition: color 140ms ease;
    }
    .nav-tab:active { transform: scale(0.93); }
    .nav-tab.is-active { color: var(--primary); }
    .nav-tab svg { width: 22px; height: 22px; stroke: currentColor; fill: none; stroke-width: 2.2; }
    .nav-tab .nav-badge {
      position: absolute;
      top: 6px;
      right: calc(50% - 17px);
      min-width: 17px;
      height: 17px;
      padding: 0 4px;
      border-radius: 999px;
      font-size: 9.5px;
      font-weight: 850;
      background: var(--danger);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 10px var(--danger);
    }

    /* Modal Sheet */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      z-index: 250;
      display: none;
      align-items: flex-end;
      justify-content: center;
    }
    .modal-overlay.is-open { display: flex; animation: fadeIn 180ms ease; }
    .modal-sheet {
      width: 100%;
      max-width: 580px;
      background: #0d121c;
      border-top: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: var(--radius-xl) var(--radius-xl) 0 0;
      padding: 20px 20px calc(24px + env(safe-area-inset-bottom, 20px));
      box-shadow: 0 -12px 48px rgba(0, 0, 0, 0.7);
      display: flex;
      flex-direction: column;
      gap: 16px;
      animation: slideUp 240ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .modal-handle {
      width: 44px; height: 4px; border-radius: 999px; background: rgba(255, 255, 255, 0.2); margin: 0 auto 6px;
    }
    .modal-header { display: flex; align-items: center; justify-content: space-between; }
    .modal-header h3 { font-size: 17px; font-weight: 800; color: #fff; }

    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }

    /* Feed and Memory */
    .memory-chapter {
      padding: 15px;
      background: var(--surface-subtle);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .memory-chapter strong { font-size: 13.5px; font-weight: 750; color: var(--purple); }
    .memory-chapter p { font-size: 12.5px; color: var(--text-muted); line-height: 1.45; }

    .feed-item {
      display: flex;
      gap: 12px;
      padding: 12px 14px;
      background: var(--surface-subtle);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      font-size: 12.5px;
    }
    .feed-icon {
      width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; flex-shrink: 0; font-size: 13px; font-weight: 800;
    }
    .feed-icon.alert { background: var(--danger-soft); color: var(--danger); border: 1px solid var(--danger-border); }
    .feed-icon.action { background: var(--primary-glow); color: var(--primary); border: 1px solid var(--border-highlight); }
    .feed-icon.system { background: rgba(255, 255, 255, 0.05); color: var(--text-muted); border: 1px solid var(--border); }
    .feed-body { min-width: 0; flex: 1; }
    .feed-body strong { display: block; font-size: 12.5px; color: var(--text); }
    .feed-body small { display: block; font-size: 11px; color: var(--text-dim); font-family: var(--font-mono); margin-top: 2px; }

    /* ---------------------------------------------------------------------
       Terminals, recipes and the terminal summary sheet (2026-09-20)
       --------------------------------------------------------------------- */
    /* A tall summary scrolls inside the sheet instead of running off the screen. */
    .modal-sheet { --sheet-pad-b: calc(24px + env(safe-area-inset-bottom, 20px)); max-height: 92vh; overflow-y: auto; overscroll-behavior: contain; }
    .action-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
    .item-row .item-info small.wrap { white-space: normal; }
    /* Seven tabs share a phone's width: a label that wrapped pushed its icon up under the badge. */
    .nav-tab span:not(.nav-badge) { white-space: nowrap; }
    @media (max-width: 400px) { .nav-tab { font-size: 10px; letter-spacing: -0.01em; } }

    .segmented {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      padding: 4px;
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
    }
    .segmented button {
      padding: 10px;
      border: 0;
      border-radius: 10px;
      background: transparent;
      color: var(--text-muted);
      font: 750 12.5px var(--font-sans);
      cursor: pointer;
      transition: all 120ms ease;
    }
    .segmented button:active { transform: scale(0.97); }
    .segmented button.is-active {
      background: rgba(56, 189, 248, 0.16);
      color: var(--primary);
      box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.4);
    }
    .segmented b { margin-left: 6px; font-family: var(--font-mono); font-weight: 700; opacity: 0.8; }

    /* A terminal in a list: the card opens its summary, its buttons act. */
    .term-card {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px;
      background: var(--surface-subtle);
      border: 1px solid var(--border);
      border-left: 3px solid var(--text-dim);
      border-radius: var(--radius-md);
      cursor: pointer;
      outline: none;
      transition: background 140ms ease, transform 120ms ease;
    }
    .term-card:active { background: var(--surface-hover); transform: scale(0.99); }
    .term-card.is-running { border-left-color: var(--ok); }
    .term-card.is-warning { border-left-color: var(--warn); }
    .term-card.is-critical { border-left-color: var(--danger); }
    .term-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .term-line { font-size: 12.5px; color: var(--text-muted); line-height: 1.4; overflow-wrap: anywhere; }
    .term-line.is-alert { color: var(--warn); }
    .term-line.is-critical { color: var(--danger); }
    .term-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding-top: 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
    }
    .term-open {
      min-width: 0;
      padding: 8px 0;
      overflow: hidden;
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-dim);
      background: none;
      border: 0;
      border-radius: 6px;
      cursor: pointer;
    }
    .term-open:focus-visible, .action-btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .term-actions { display: flex; flex-shrink: 0; gap: 6px; }

    /* The summary sheet. */
    .detail { display: flex; flex-direction: column; gap: 14px; }
    .detail-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .detail-role { font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); }
    .detail-headline { font-size: 14.5px; font-weight: 700; line-height: 1.4; color: var(--text); overflow-wrap: anywhere; }
    .detail-now { margin-top: -8px; font-size: 12.5px; color: var(--text-muted); }
    .fact-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .fact-grid > div {
      min-width: 0;
      padding: 10px 12px;
      background: var(--surface-subtle);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
    }
    .fact-grid > div.wide { grid-column: 1 / -1; }
    .fact-grid small {
      display: block;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-dim);
    }
    .fact-grid b { display: block; margin-top: 2px; font-size: 13px; font-weight: 700; color: var(--text); overflow-wrap: anywhere; }
    .fact-grid b.mono { font-family: var(--font-mono); font-size: 12px; font-weight: 600; }
    .signal-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .signal {
      display: inline-flex;
      align-items: baseline;
      gap: 6px;
      padding: 5px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 650;
      color: var(--text-muted);
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      overflow-wrap: anywhere;
    }
    .signal small { font-size: 10px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-dim); }
    .signal.running { color: var(--ok); background: var(--ok-soft); border-color: var(--ok-border); }
    .signal.critical { color: var(--danger); background: var(--danger-soft); border-color: var(--danger-border); }
    .health-note {
      padding: 10px 12px;
      font-size: 12.5px;
      line-height: 1.45;
      color: var(--text-muted);
      background: var(--surface-subtle);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
    }
    .health-note strong { color: var(--text); }
    .term-cap {
      display: block;
      margin-bottom: 6px;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-dim);
    }
    .term-out {
      margin: 0;
      max-height: 220px;
      padding: 12px;
      overflow: auto;
      font-family: var(--font-mono);
      font-size: 11.5px;
      line-height: 1.5;
      color: #cbd5e1;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: rgba(0, 0, 0, 0.5);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      user-select: text;
      -webkit-user-select: text;
    }
    .term-empty {
      padding: 12px;
      font-size: 12.5px;
      line-height: 1.45;
      color: var(--text-muted);
      background: var(--surface-subtle);
      border: 1px dashed var(--border);
      border-radius: var(--radius-sm);
    }
    .detail-actions {
      /* Pinned under the thumb while the summary scrolls. It reaches down over the
         sheet's own bottom padding, or the content would show beneath it. */
      position: sticky;
      bottom: calc(-1 * var(--sheet-pad-b));
      z-index: 2;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 -20px calc(-1 * var(--sheet-pad-b));
      padding: 14px 20px var(--sheet-pad-b);
      background: linear-gradient(180deg, rgba(13, 18, 28, 0), #0d121c 16px);
    }
    .detail-actions .action-btn { flex: 1 1 0; min-height: 44px; font-size: 13px; }

    /* Confirmations. */
    .confirm { display: flex; flex-direction: column; gap: 16px; }
    .confirm p { font-size: 13.5px; line-height: 1.5; color: var(--text-muted); }
    .confirm p strong { color: var(--text); }
    .confirm-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .confirm-actions .btn { padding: 13px 12px; }
    .btn-danger { background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); box-shadow: 0 4px 18px rgba(220, 38, 38, 0.35); }

    /* Recipes. */
    .recipe-card { display: flex; flex-direction: column; gap: 12px; padding: 16px; }
    .recipe-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .recipe-steps { display: flex; flex-direction: column; gap: 6px; list-style: none; }
    .recipe-steps li {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      font-size: 12.5px;
      background: var(--surface-subtle);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
    }
    .recipe-steps li i { flex-shrink: 0; width: 8px; height: 8px; border-radius: 50%; background: var(--text-dim); }
    .recipe-steps li.is-ok i { background: var(--ok); box-shadow: 0 0 8px var(--ok-glow); }
    .recipe-steps li.is-busy i { background: var(--warn); box-shadow: 0 0 8px var(--warn-glow); }
    .recipe-steps li.is-bad i { background: var(--danger); box-shadow: 0 0 8px var(--danger-glow); }
    .recipe-steps li b { min-width: 0; overflow: hidden; font-weight: 700; color: var(--text); text-overflow: ellipsis; white-space: nowrap; }
    .recipe-steps li small { max-width: 45%; margin-left: auto; overflow: hidden; font-size: 11px; color: var(--text-dim); text-overflow: ellipsis; white-space: nowrap; }
    .recipe-fail { font-size: 12.5px; line-height: 1.4; color: var(--danger); overflow-wrap: anywhere; }
    .recipe-actions { display: flex; gap: 8px; }
    .recipe-actions .action-btn { flex: 1; min-height: 44px; font-size: 13px; }

    /* Responsive Desktop & Tablet Web App Styles */
    @media (min-width: 768px) {
      body {
        padding-bottom: 32px;
      }
      header {
        padding: 14px 28px;
        gap: 20px;
      }
      .desktop-nav {
        display: flex;
      }
      nav.bottom-nav {
        display: none !important;
      }
      main {
        max-width: 1140px;
        padding: 24px 24px 40px;
        gap: 20px;
      }
      .telemetry-grid {
        grid-template-columns: repeat(4, 1fr);
        gap: 14px;
      }
      .telemetry-tile {
        padding: 18px 16px;
      }
      .telemetry-tile b {
        font-size: 32px;
      }
      .card.pair-form {
        max-width: 480px;
        margin: 36px auto;
        padding: 34px 30px;
      }
      .modal-overlay {
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      .modal-sheet {
        border-radius: 20px;
        max-width: 600px;
        margin: auto;
        box-shadow: 0 24px 72px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.1);
        max-height: 85vh;
      }
      .modal-handle {
        display: none;
      }
      .ask-composer {
        position: sticky;
        bottom: 12px;
        max-width: 1140px;
        margin: 0 auto;
        left: auto;
        right: auto;
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="toast-container" id="toastContainer"></div>

  <header>
    <div class="brand" onclick="switchTab('overview')">
      <img class="brand-mark" src="/mobile/icon-192.png" alt="" width="38" height="38">
      <div class="brand-title">
        <strong id="headerTitle">OUTARCH</strong>
        <small id="headerSubtitle">Web Companion</small>
      </div>
    </div>

    <nav class="desktop-nav" id="desktopNav" style="display:none">
      <button class="desktop-nav-tab is-active" data-tab="overview" onclick="switchTab('overview')">
        <svg viewBox="0 0 24 24"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
        <span>Cockpit</span>
      </button>
      <button class="desktop-nav-tab" data-tab="workers" onclick="switchTab('workers')">
        <svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 8 6 4-6 4Z"/></svg>
        <span>Workers</span>
      </button>
      <button class="desktop-nav-tab" data-tab="needs" onclick="switchTab('needs')">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>Needs You</span>
        <span class="desktop-nav-badge" id="desktopNavBadgeNeeds" style="display:none">0</span>
      </button>
      <button class="desktop-nav-tab" data-tab="ask" id="desktopNavTabAsk" style="display:none" onclick="switchTab('ask')">
        <svg viewBox="0 0 24 24"><path d="M12 3c.4 4.4 4.1 8.1 8.5 8.5-4.4.4-8.1 4.1-8.5 8.5-.4-4.4-4.1-8.1-8.5-8.5C7.9 11.1 11.6 7.4 12 3Z"/></svg>
        <span>Ask AI</span>
      </button>
      <button class="desktop-nav-tab" data-tab="memory" onclick="switchTab('memory')">
        <svg viewBox="0 0 24 24"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10"/><path d="M6 10h10"/></svg>
        <span>Memory</span>
      </button>
      <button class="desktop-nav-tab" data-tab="feed" onclick="switchTab('feed')">
        <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>Feed</span>
      </button>
      <button class="desktop-nav-tab" data-tab="settings" onclick="switchTab('settings')">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        <span>Settings</span>
      </button>
    </nav>

    <div class="header-actions">
      <div id="connectionStatus" class="status-badge is-offline" onclick="refreshDashboard(true)" title="Tap to refresh"><i></i><span>Offline</span></div>
      <button class="icon-btn" onclick="toggleNotificationsPrompt()" title="Alerts & Notification settings">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        <span id="headerBadge" class="badge-dot" style="display:none"></span>
      </button>
    </div>
  </header>

  <main id="appContainer">
    <div class="pwa-banner" id="pwaBanner">
      <div class="pwa-banner-text">
        <strong>Install Companion App</strong>
        <small>Add to Home Screen for instant full-screen access</small>
      </div>
      <button class="btn-install" id="btnInstallPwa">Install</button>
    </div>
    <div class="card"><p class="msg">Initializing secure mobile companion…</p></div>
  </main>

  <nav class="bottom-nav" id="bottomNav" style="display:none">
    <div class="nav-tab is-active" data-tab="overview" onclick="switchTab('overview')">
      <svg viewBox="0 0 24 24"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
      <span>Cockpit</span>
    </div>
    <div class="nav-tab" data-tab="workers" onclick="switchTab('workers')">
      <svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 8 6 4-6 4Z"/></svg>
      <span>Workers</span>
    </div>
    <div class="nav-tab" data-tab="needs" onclick="switchTab('needs')">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
      <span>Needs You</span>
      <span class="nav-badge" id="navBadgeNeeds" style="display:none">0</span>
    </div>
    <div class="nav-tab" data-tab="ask" id="navTabAsk" style="display:none" onclick="switchTab('ask')">
      <svg viewBox="0 0 24 24"><path d="M12 3c.4 4.4 4.1 8.1 8.5 8.5-4.4.4-8.1 4.1-8.5 8.5-.4-4.4-4.1-8.1-8.5-8.5C7.9 11.1 11.6 7.4 12 3Z"/></svg>
      <span>Ask</span>
    </div>
    <div class="nav-tab" data-tab="memory" onclick="switchTab('memory')">
      <svg viewBox="0 0 24 24"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10"/><path d="M6 10h10"/></svg>
      <span>Memory</span>
    </div>
    <div class="nav-tab" data-tab="feed" onclick="switchTab('feed')">
      <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span>Feed</span>
    </div>
    <div class="nav-tab" data-tab="settings" onclick="switchTab('settings')">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      <span>Settings</span>
    </div>
  </nav>

  <!-- Interactive Action Sheet Modal -->
  <div class="modal-overlay" id="actionModal" onclick="closeActionModal(event)">
    <div class="modal-sheet" onclick="event.stopPropagation()">
      <div class="modal-handle"></div>
      <div class="modal-header">
        <h3 id="modalTitle">Request Action</h3>
        <button class="icon-btn" onclick="closeActionModal()" style="width:30px;height:30px;border:none;">✕</button>
      </div>
      <div id="modalBody"></div>
    </div>
  </div>

  <script>
    const API_VERSION = 1;
    const STORAGE_KEY = "mission_control_mobile_v1";
    const FEED_STORAGE_KEY = "mission_control_mobile_feed_v1";
    const PREFS_STORAGE_KEY = "mission_control_mobile_prefs_v1";

    // ---------------------------------------------------------------------------
    // Pure JS Cryptography Engine (Fallback for LAN HTTP where window.crypto.subtle is undefined)
    // ---------------------------------------------------------------------------
    const PureCrypto = (() => {
      // 1. SHA-256
      const K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
      ];

      function sha256(data) {
        const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
        const len = bytes.length;
        const bitLen = len * 8;
        const padLen = ((len + 8) >> 6) + 1 << 6;
        const words = new Uint32Array(padLen >> 2);
        for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
        words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
        words[words.length - 1] = bitLen & 0xffffffff;
        words[words.length - 2] = Math.floor(bitLen / 0x100000000);

        let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
        let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
        const w = new Uint32Array(64);

        for (let i = 0; i < words.length; i += 16) {
          for (let t = 0; t < 16; t++) w[t] = words[i + t];
          for (let t = 16; t < 64; t++) {
            const s0 = ((w[t - 15] >>> 7) | (w[t - 15] << 25)) ^ ((w[t - 15] >>> 18) | (w[t - 15] << 14)) ^ (w[t - 15] >>> 3);
            const s1 = ((w[t - 2] >>> 17) | (w[t - 2] << 15)) ^ ((w[t - 2] >>> 19) | (w[t - 2] << 13)) ^ (w[t - 2] >>> 10);
            w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
          }
          let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
          for (let t = 0; t < 64; t++) {
            const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            const ch = (e & f) ^ ((~e) & g);
            const temp1 = (h + s1 + ch + K[t] + w[t]) | 0;
            const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (s0 + maj) | 0;
            h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
          }
          h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
          h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
        }
        const out = new Uint8Array(32);
        const hashArr = [h0, h1, h2, h3, h4, h5, h6, h7];
        for (let i = 0; i < 8; i++) {
          out[i * 4] = (hashArr[i] >>> 24) & 0xff;
          out[i * 4 + 1] = (hashArr[i] >>> 16) & 0xff;
          out[i * 4 + 2] = (hashArr[i] >>> 8) & 0xff;
          out[i * 4 + 3] = hashArr[i] & 0xff;
        }
        return out;
      }

      // 2. HMAC-SHA256
      function hmacSha256(key, message) {
        let k = typeof key === "string" ? new TextEncoder().encode(key) : new Uint8Array(key);
        const m = typeof message === "string" ? new TextEncoder().encode(message) : new Uint8Array(message);
        if (k.length > 64) k = sha256(k);
        const oPad = new Uint8Array(64);
        const iPad = new Uint8Array(64);
        for (let i = 0; i < 64; i++) {
          const byte = i < k.length ? k[i] : 0;
          oPad[i] = byte ^ 0x5c;
          iPad[i] = byte ^ 0x36;
        }
        const inner = new Uint8Array(64 + m.length);
        inner.set(iPad, 0); inner.set(m, 64);
        const innerHash = sha256(inner);
        const outer = new Uint8Array(64 + 32);
        outer.set(oPad, 0); outer.set(innerHash, 64);
        return sha256(outer);
      }

      // 3. HKDF-SHA256
      function hkdfSha256(ikm, salt, info, length = 32) {
        const prk = hmacSha256(salt && salt.length ? salt : new Uint8Array(32), ikm);
        const infoBytes = typeof info === "string" ? new TextEncoder().encode(info) : (info || new Uint8Array(0));
        const t = new Uint8Array(infoBytes.length + 1);
        t.set(infoBytes, 0);
        t[infoBytes.length] = 1;
        const okm = hmacSha256(prk, t);
        return okm.slice(0, length);
      }

      // 4. X25519 (RFC 7748 Montgomery ladder over BigInt)
      const P = 2n ** 255n - 19n;
      const A24 = 121665n;
      function mod(n, m = P) { const res = n % m; return res >= 0n ? res : res + m; }
      function modExp(b, e, m = P) {
        let res = 1n; b = mod(b, m);
        while (e > 0n) { if (e & 1n) res = mod(res * b, m); e >>= 1n; b = mod(b * b, m); }
        return res;
      }
      function modInv(n, m = P) { return modExp(n, m - 2n, m); }

      function x25519ScalarMult(scalarBytes, pointBytes) {
        const k = new Uint8Array(scalarBytes);
        k[0] &= 248; k[31] &= 127; k[31] |= 64;
        let kVal = 0n; for (let i = 0; i < 32; i++) kVal |= BigInt(k[i]) << BigInt(8 * i);
        let u = 0n; for (let i = 0; i < 32; i++) u |= BigInt(pointBytes[i]) << BigInt(8 * i);
        u = mod(u);
        let x1 = u, x2 = 1n, z2 = 0n, x3 = u, z3 = 1n, swap = 0n;
        for (let t = 254; t >= 0; t--) {
          const k_t = (kVal >> BigInt(t)) & 1n;
          swap ^= k_t;
          if (swap) { let tx = x2; x2 = x3; x3 = tx; let tz = z2; z2 = z3; z3 = tz; }
          swap = k_t;
          const A = mod(x2 + z2), AA = mod(A * A), B = mod(x2 - z2), BB = mod(B * B), E = mod(AA - BB);
          const C = mod(x3 + z3), D = mod(x3 - z3), DA = mod(D * A), CB = mod(C * B);
          x3 = mod(mod(DA + CB) ** 2n);
          z3 = mod(x1 * mod(DA - CB) ** 2n);
          x2 = mod(AA * BB);
          z2 = mod(E * mod(AA + mod(A24 * E)));
        }
        if (swap) { let tx = x2; x2 = x3; x3 = tx; let tz = z2; z2 = z3; z3 = tz; }
        const resultVal = mod(x2 * modInv(z2));
        const result = new Uint8Array(32);
        let v = resultVal;
        for (let i = 0; i < 32; i++) { result[i] = Number(v & 0xffn); v >>= 8n; }
        return result;
      }

      const SPKI_PREFIX = new Uint8Array([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00]);
      function x25519ExportSpki(rawPub) {
        const spki = new Uint8Array(44);
        spki.set(SPKI_PREFIX, 0);
        spki.set(rawPub, 12);
        return spki;
      }
      function x25519ExtractRawFromSpki(spki) {
        const bytes = new Uint8Array(spki);
        if (bytes.length === 44 && bytes[0] === 0x30) return bytes.slice(12, 44);
        if (bytes.length === 32) return bytes;
        throw new Error("Invalid X25519 public key format");
      }

      // 5. AES-256-GCM
      const SBOX = new Uint8Array([
        0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
        0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
        0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
        0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
        0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
        0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
        0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
        0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
        0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
        0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
        0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
        0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
        0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
        0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
        0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
        0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16
      ]);
      const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

      function aesKeyExpansion(keyBytes) {
        const Nk = 8, Nr = 14;
        const w = new Uint32Array(4 * (Nr + 1));
        for (let i = 0; i < Nk; i++) w[i] = (keyBytes[4 * i] << 24) | (keyBytes[4 * i + 1] << 16) | (keyBytes[4 * i + 2] << 8) | keyBytes[4 * i + 3];
        for (let i = Nk; i < 4 * (Nr + 1); i++) {
          let temp = w[i - 1];
          if (i % Nk === 0) {
            const rot = ((temp << 8) | (temp >>> 24)) >>> 0;
            temp = (SBOX[(rot >>> 24) & 0xff] << 24) | (SBOX[(rot >>> 16) & 0xff] << 16) | (SBOX[(rot >>> 8) & 0xff] << 8) | SBOX[rot & 0xff];
            temp ^= (RCON[(i / Nk) - 1] << 24);
          } else if (Nk > 6 && i % Nk === 4) {
            temp = (SBOX[(temp >>> 24) & 0xff] << 24) | (SBOX[(temp >>> 16) & 0xff] << 16) | (SBOX[(temp >>> 8) & 0xff] << 8) | SBOX[temp & 0xff];
          }
          w[i] = (w[i - Nk] ^ temp) >>> 0;
        }
        return w;
      }

      function xtime(a) { return (a << 1) ^ (((a >>> 7) & 1) * 0x11b); }

      function aesEncryptBlock(w, inBytes, outBytes) {
        let s0 = inBytes[0] ^ (w[0] >>> 24), s1 = inBytes[1] ^ ((w[0] >>> 16) & 0xff), s2 = inBytes[2] ^ ((w[0] >>> 8) & 0xff), s3 = inBytes[3] ^ (w[0] & 0xff);
        let s4 = inBytes[4] ^ (w[1] >>> 24), s5 = inBytes[5] ^ ((w[1] >>> 16) & 0xff), s6 = inBytes[6] ^ ((w[1] >>> 8) & 0xff), s7 = inBytes[7] ^ (w[1] & 0xff);
        let s8 = inBytes[8] ^ (w[2] >>> 24), s9 = inBytes[9] ^ ((w[2] >>> 16) & 0xff), s10 = inBytes[10] ^ ((w[2] >>> 8) & 0xff), s11 = inBytes[11] ^ (w[2] & 0xff);
        let s12 = inBytes[12] ^ (w[3] >>> 24), s13 = inBytes[13] ^ ((w[3] >>> 16) & 0xff), s14 = inBytes[14] ^ ((w[3] >>> 8) & 0xff), s15 = inBytes[15] ^ (w[3] & 0xff);
        for (let r = 1; r < 14; r++) {
          const k0 = w[4 * r], k1 = w[4 * r + 1], k2 = w[4 * r + 2], k3 = w[4 * r + 3];
          const t0 = SBOX[s0], t1 = SBOX[s5], t2 = SBOX[s10], t3 = SBOX[s15];
          const t4 = SBOX[s4], t5 = SBOX[s9], t6 = SBOX[s14], t7 = SBOX[s3];
          const t8 = SBOX[s8], t9 = SBOX[s13], t10 = SBOX[s2], t11 = SBOX[s7];
          const t12 = SBOX[s12], t13 = SBOX[s1], t14 = SBOX[s6], t15 = SBOX[s11];
          s0 = xtime(t0 ^ t1) ^ t1 ^ t2 ^ t3 ^ (k0 >>> 24);
          s1 = xtime(t1 ^ t2) ^ t2 ^ t3 ^ t0 ^ ((k0 >>> 16) & 0xff);
          s2 = xtime(t2 ^ t3) ^ t3 ^ t0 ^ t1 ^ ((k0 >>> 8) & 0xff);
          s3 = xtime(t3 ^ t0) ^ t0 ^ t1 ^ t2 ^ (k0 & 0xff);
          s4 = xtime(t4 ^ t5) ^ t5 ^ t6 ^ t7 ^ (k1 >>> 24);
          s5 = xtime(t5 ^ t6) ^ t6 ^ t7 ^ t4 ^ ((k1 >>> 16) & 0xff);
          s6 = xtime(t6 ^ t7) ^ t7 ^ t4 ^ t5 ^ ((k1 >>> 8) & 0xff);
          s7 = xtime(t7 ^ t4) ^ t4 ^ t5 ^ t6 ^ (k1 & 0xff);
          s8 = xtime(t8 ^ t9) ^ t9 ^ t10 ^ t11 ^ (k2 >>> 24);
          s9 = xtime(t9 ^ t10) ^ t10 ^ t11 ^ t8 ^ ((k2 >>> 16) & 0xff);
          s10 = xtime(t10 ^ t11) ^ t11 ^ t8 ^ t9 ^ ((k2 >>> 8) & 0xff);
          s11 = xtime(t11 ^ t8) ^ t8 ^ t9 ^ t10 ^ (k2 & 0xff);
          s12 = xtime(t12 ^ t13) ^ t13 ^ t14 ^ t15 ^ (k3 >>> 24);
          s13 = xtime(t13 ^ t14) ^ t14 ^ t15 ^ t12 ^ ((k3 >>> 16) & 0xff);
          s14 = xtime(t14 ^ t15) ^ t15 ^ t12 ^ t13 ^ ((k3 >>> 8) & 0xff);
          s15 = xtime(t15 ^ t12) ^ t12 ^ t13 ^ t14 ^ (k3 & 0xff);
        }
        const k0 = w[56], k1 = w[57], k2 = w[58], k3 = w[59];
        outBytes[0] = SBOX[s0] ^ (k0 >>> 24); outBytes[1] = SBOX[s5] ^ ((k0 >>> 16) & 0xff); outBytes[2] = SBOX[s10] ^ ((k0 >>> 8) & 0xff); outBytes[3] = SBOX[s15] ^ (k0 & 0xff);
        outBytes[4] = SBOX[s4] ^ (k1 >>> 24); outBytes[5] = SBOX[s9] ^ ((k1 >>> 16) & 0xff); outBytes[6] = SBOX[s14] ^ ((k1 >>> 8) & 0xff); outBytes[7] = SBOX[s3] ^ (k1 & 0xff);
        outBytes[8] = SBOX[s8] ^ (k2 >>> 24); outBytes[9] = SBOX[s13] ^ ((k2 >>> 16) & 0xff); outBytes[10] = SBOX[s2] ^ ((k2 >>> 8) & 0xff); outBytes[11] = SBOX[s7] ^ (k2 & 0xff);
        outBytes[12] = SBOX[s12] ^ (k3 >>> 24); outBytes[13] = SBOX[s1] ^ ((k3 >>> 16) & 0xff); outBytes[14] = SBOX[s6] ^ ((k3 >>> 8) & 0xff); outBytes[15] = SBOX[s11] ^ (k3 & 0xff);
      }

      function ghashMul(X, Y) {
        let z0 = 0n, z1 = 0n;
        let v0 = (BigInt(Y[0]) << 56n) | (BigInt(Y[1]) << 48n) | (BigInt(Y[2]) << 40n) | (BigInt(Y[3]) << 32n) |
                 (BigInt(Y[4]) << 24n) | (BigInt(Y[5]) << 16n) | (BigInt(Y[6]) << 8n) | BigInt(Y[7]);
        let v1 = (BigInt(Y[8]) << 56n) | (BigInt(Y[9]) << 48n) | (BigInt(Y[10]) << 40n) | (BigInt(Y[11]) << 32n) |
                 (BigInt(Y[12]) << 24n) | (BigInt(Y[13]) << 16n) | (BigInt(Y[14]) << 8n) | BigInt(Y[15]);
        const R = 0xe100000000000000n;
        for (let i = 0; i < 16; i++) {
          const byte = X[i];
          for (let b = 7; b >= 0; b--) {
            if ((byte >> b) & 1) { z0 ^= v0; z1 ^= v1; }
            const lsb = v1 & 1n;
            v1 = (v1 >> 1n) | ((v0 & 1n) << 63n);
            v0 = v0 >> 1n;
            if (lsb) v0 ^= R;
          }
        }
        const out = new Uint8Array(16);
        for (let i = 0; i < 8; i++) { out[i] = Number((z0 >> BigInt(56 - i * 8)) & 0xffn); out[8 + i] = Number((z1 >> BigInt(56 - i * 8)) & 0xffn); }
        return out;
      }

      function ghash(H, aad, cipher) {
        let tag = new Uint8Array(16);
        function processBlock(block) {
          for (let i = 0; i < 16; i++) tag[i] ^= block[i];
          tag = ghashMul(tag, H);
        }
        const aadLen = aad ? aad.length : 0;
        for (let i = 0; i < aadLen; i += 16) {
          const block = new Uint8Array(16);
          block.set(aad.slice(i, i + 16), 0);
          processBlock(block);
        }
        const cipherLen = cipher ? cipher.length : 0;
        for (let i = 0; i < cipherLen; i += 16) {
          const block = new Uint8Array(16);
          block.set(cipher.slice(i, i + 16), 0);
          processBlock(block);
        }
        const lenBlock = new Uint8Array(16);
        const aadBits = BigInt(aadLen) * 8n;
        const cipherBits = BigInt(cipherLen) * 8n;
        for (let i = 0; i < 8; i++) {
          lenBlock[i] = Number((aadBits >> BigInt(56 - i * 8)) & 0xffn);
          lenBlock[8 + i] = Number((cipherBits >> BigInt(56 - i * 8)) & 0xffn);
        }
        processBlock(lenBlock);
        return tag;
      }

      function inc32(counter) {
        for (let i = 15; i >= 12; i--) {
          counter[i] = (counter[i] + 1) & 0xff;
          if (counter[i] !== 0) break;
        }
      }

      function aesGcmEncrypt(keyBytes, ivBytes, plaintextBytes, aadBytes) {
        const w = aesKeyExpansion(keyBytes);
        const H = new Uint8Array(16);
        aesEncryptBlock(w, new Uint8Array(16), H);
        const J0 = new Uint8Array(16);
        J0.set(ivBytes, 0); J0[15] = 1;
        const J = new Uint8Array(J0);
        const ciphertext = new Uint8Array(plaintextBytes.length);
        const keystreamBlock = new Uint8Array(16);
        for (let i = 0; i < plaintextBytes.length; i += 16) {
          inc32(J);
          aesEncryptBlock(w, J, keystreamBlock);
          const blockLen = Math.min(16, plaintextBytes.length - i);
          for (let b = 0; b < blockLen; b++) ciphertext[i + b] = plaintextBytes[i + b] ^ keystreamBlock[b];
        }
        const S = ghash(H, aadBytes, ciphertext);
        const tagBlock = new Uint8Array(16);
        aesEncryptBlock(w, J0, tagBlock);
        const tag = new Uint8Array(16);
        for (let i = 0; i < 16; i++) tag[i] = S[i] ^ tagBlock[i];
        return { ciphertext, tag };
      }

      function aesGcmDecrypt(keyBytes, ivBytes, ciphertextBytes, tagBytes, aadBytes) {
        const w = aesKeyExpansion(keyBytes);
        const H = new Uint8Array(16);
        aesEncryptBlock(w, new Uint8Array(16), H);
        const J0 = new Uint8Array(16);
        J0.set(ivBytes, 0); J0[15] = 1;
        const S = ghash(H, aadBytes, ciphertextBytes);
        const tagBlock = new Uint8Array(16);
        aesEncryptBlock(w, J0, tagBlock);
        const expectedTag = new Uint8Array(16);
        for (let i = 0; i < 16; i++) expectedTag[i] = S[i] ^ tagBlock[i];
        let diff = 0;
        for (let i = 0; i < 16; i++) diff |= expectedTag[i] ^ tagBytes[i];
        if (diff !== 0) throw new Error("Authentication tag verification failed");
        const J = new Uint8Array(J0);
        const plaintext = new Uint8Array(ciphertextBytes.length);
        const keystreamBlock = new Uint8Array(16);
        for (let i = 0; i < ciphertextBytes.length; i += 16) {
          inc32(J);
          aesEncryptBlock(w, J, keystreamBlock);
          const blockLen = Math.min(16, ciphertextBytes.length - i);
          for (let b = 0; b < blockLen; b++) plaintext[i + b] = ciphertextBytes[i + b] ^ keystreamBlock[b];
        }
        return plaintext;
      }

      function getRandomBytes(length) {
        const buf = new Uint8Array(length);
        if (window.crypto && window.crypto.getRandomValues) {
          window.crypto.getRandomValues(buf);
        } else {
          for (let i = 0; i < length; i++) buf[i] = Math.floor(Math.random() * 256);
        }
        return buf;
      }

      return {
        sha256,
        hmacSha256,
        hkdfSha256,
        x25519ScalarMult,
        x25519ExportSpki,
        x25519ExtractRawFromSpki,
        aesGcmEncrypt,
        aesGcmDecrypt,
        getRandomBytes
      };
    })();

    // ---------------------------------------------------------------------------
    // Audio Synthesizer & Haptic Engine
    // ---------------------------------------------------------------------------
    const SoundFx = (() => {
      let audioCtx = null;
      function getCtx() {
        if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
        return audioCtx;
      }
      return {
        beep(type = "info") {
          const prefs = getPreferences();
          if (!prefs.sound) return;
          try {
            const ctx = getCtx();
            if (!ctx) return;
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            if (type === "alert") {
              osc.type = "triangle";
              osc.frequency.setValueAtTime(520, now);
              osc.frequency.exponentialRampToValueAtTime(880, now + 0.18);
              gain.gain.setValueAtTime(0.35, now);
              gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
              osc.start(now);
              osc.stop(now + 0.35);
            } else if (type === "success") {
              osc.type = "sine";
              osc.frequency.setValueAtTime(440, now);
              osc.frequency.setValueAtTime(660, now + 0.08);
              gain.gain.setValueAtTime(0.25, now);
              gain.gain.exponentialRampToValueAtTime(0.01, now + 0.28);
              osc.start(now);
              osc.stop(now + 0.28);
            } else {
              osc.type = "sine";
              osc.frequency.setValueAtTime(580, now);
              gain.gain.setValueAtTime(0.18, now);
              gain.gain.exponentialRampToValueAtTime(0.01, now + 0.14);
              osc.start(now);
              osc.stop(now + 0.14);
            }
          } catch {}
        },
        vibrate(pattern = [120, 60, 120]) {
          const prefs = getPreferences();
          if (prefs.vibrate && navigator.vibrate) {
            try { navigator.vibrate(pattern); } catch {}
          }
        }
      };
    })();

    // ---------------------------------------------------------------------------
    // State, Preferences, & Feed History
    // ---------------------------------------------------------------------------
    let appState = {
      tab: "overview",
      data: null,
      error: "",
      loading: false,
      pollTimer: null,
      sse: null,
      workerFilter: "all",
      // Terminals or recipes, inside the Workers tab.
      workersView: "terminals",
      // What this phone may do right now, as the desktop last said it.
      caps: null,
      // Requests in flight, by "worker:<id>" or "recipe:<id>": the buttons show it.
      busy: {},
      // The terminal whose summary sheet is open, and what was read from it.
      detail: null,
      confirming: false,
      // The markup last painted, so an unchanged poll writes nothing.
      lastHtml: "",
      modalHtml: "",
      searchQuery: "",
      previousAttentionCount: 0,
      // The Ask thread lives in memory only: answers can quote terminal output,
      // and a phone's storage is the wrong place to keep that.
      ask: { messages: [], busy: false, draft: "" }
    };

    // Everything this page shows comes from the desktop: worker names and
    // commands from workspace.json, reasons and memory from terminal output.
    // It is text, never markup, so every value placed into HTML goes through
    // esc(), and an action reads its target from data- attributes instead of
    // from a string spliced into an inline handler (where one apostrophe in a
    // worker name was enough to break the button).
    const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    function esc(value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
    }
    function workerActionAttrs(id, action, name) {
      return 'data-id="' + esc(id) + '" data-action="' + esc(action) + '" data-name="' + esc(name) + '" onclick="promptWorkerAction(this.dataset.id, this.dataset.action, this.dataset.name)"';
    }

    function getStoredCredential() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); }
      catch { return null; }
    }
    function saveCredential(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    function clearCredential() {
      if (confirm("Disconnect and unpair this mobile companion device?")) {
        localStorage.removeItem(STORAGE_KEY);
        render();
      }
    }

    function getPreferences() {
      try {
        const stored = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY));
        return { sound: true, vibrate: true, notifications: true, ...stored };
      } catch {
        return { sound: true, vibrate: true, notifications: true };
      }
    }
    function savePreferences(prefs) {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    }

    function getFeedItems() {
      try { return JSON.parse(localStorage.getItem(FEED_STORAGE_KEY)) || []; }
      catch { return []; }
    }
    function appendFeedItem(item) {
      const items = [{ id: "feed-" + Math.random().toString(36).slice(2), at: Date.now(), ...item }, ...getFeedItems()].slice(0, 60);
      localStorage.setItem(FEED_STORAGE_KEY, JSON.stringify(items));
    }

    function showToast(text, type = "info") {
      const container = document.getElementById("toastContainer");
      if (!container) return;
      const el = document.createElement("div");
      el.className = "toast " + (type === "critical" ? "alert-critical" : type === "warning" ? "alert-warning" : type === "success" ? "alert-success" : "");
      // Toast text carries worker names and reasons from the desktop: text only.
      const message = document.createElement("span");
      message.textContent = String(text == null ? "" : text);
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.setAttribute("aria-label", "Dismiss");
      dismiss.style.cssText = "background:none;border:none;color:inherit;cursor:pointer;font-size:14px;padding:0 4px;";
      dismiss.textContent = "✕";
      dismiss.addEventListener("click", () => el.remove());
      el.append(message, dismiss);
      container.appendChild(el);
      setTimeout(() => el.remove(), 4500);
    }

    function triggerAlertNotification(title, body, severity = "warning") {
      SoundFx.beep(severity === "critical" ? "alert" : "info");
      SoundFx.vibrate(severity === "critical" ? [200, 100, 200] : [120, 60, 120]);
      showToast(body, severity);
      appendFeedItem({ kind: "alert", title, detail: body, severity });

      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification(title, { body, tag: "mc-alert", renotify: true });
        } catch {}
      }
    }

    function b64UrlToBuf(b64) {
      let str = b64.replace(/-/g, '+').replace(/_/g, '/');
      while (str.length % 4) str += '=';
      const bin = atob(str);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }

    function bufToB64Url(buf) {
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    }

    // ---------------------------------------------------------------------------
    // Cryptographic Pair & Request Protocol
    // ---------------------------------------------------------------------------
    let isPairing = false;

    async function pairWithDesktop(code, deviceName) {
      if (isPairing) return;
      isPairing = true;
      try {
        const endpoint = window.location.origin;
        const inviteRes = await fetch(endpoint + "/mobile/v1/invite");
        if (!inviteRes.ok) {
          throw new Error("No active pairing session found on desktop. Click 'Invite Device' in OUTARCH Settings.");
        }
        const invite = await inviteRes.json();

        // 1. Generate client X25519 keypair
        let clientPriv = PureCrypto.getRandomBytes(32);
        const basePoint = new Uint8Array(32); basePoint[0] = 9;
        const rawClientPub = PureCrypto.x25519ScalarMult(clientPriv, basePoint);
        const clientPubSpki = PureCrypto.x25519ExportSpki(rawClientPub);
        const clientPublicKey = bufToB64Url(clientPubSpki);

        // 2. Compute HMAC-SHA256 proof without revealing code
        const message = invite.pairingId + "|" + invite.nonce + "|" + deviceName.trim() + "|" + clientPublicKey;
        const proofBuf = PureCrypto.hmacSha256(code.trim(), message);
        const proof = bufToB64Url(proofBuf);

        // 3. Post pairing request
        const pairRes = await fetch(endpoint + "/mobile/v1/pair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pairingId: invite.pairingId,
            deviceName: deviceName.trim(),
            clientPublicKey: clientPublicKey,
            proof: proof
          })
        });

        if (!pairRes.ok) {
          const err = await pairRes.json().catch(() => ({}));
          throw new Error(err.error || "Pairing failed. The 6-digit code may be incorrect or expired.");
        }
        const pairData = await pairRes.json();

        // 4. Derive shared key using ECDH + HKDF
        const serverKeySpki = b64UrlToBuf(invite.serverPublicKey);
        const serverRawPub = PureCrypto.x25519ExtractRawFromSpki(serverKeySpki);
        const sharedBits = PureCrypto.x25519ScalarMult(clientPriv, serverRawPub);
        const saltBuf = b64UrlToBuf(invite.nonce);
        const aesKey = PureCrypto.hkdfSha256(sharedBits, saltBuf, "mission-control-mobile-pairing-v1", 32);

        // 5. Decrypt pairing envelope
        const envelope = pairData.envelope;
        const iv = b64UrlToBuf(envelope.iv);
        const ciphertext = b64UrlToBuf(envelope.ciphertext);
        const tag = b64UrlToBuf(envelope.tag);
        const aad = new TextEncoder().encode(invite.pairingId);

        const decryptedBuf = PureCrypto.aesGcmDecrypt(aesKey, iv, ciphertext, tag, aad);
        const cred = JSON.parse(new TextDecoder().decode(decryptedBuf));

        cred.endpoint = endpoint;
        cred.deviceName = deviceName;
        saveCredential(cred);
        SoundFx.beep("success");
        appendFeedItem({ kind: "system", title: "Companion Paired", detail: "Connected to " + endpoint });
        return cred;
      } finally {
        isPairing = false;
      }
    }

    async function sendEncryptedRequest(cred, payload) {
      const enc = new TextEncoder();
      const deviceId = cred.deviceId;
      const secretBuf = b64UrlToBuf(cred.secret);
      const timestamp = Date.now();
      const nonce = "web-" + Math.random().toString(36).slice(2) + "-" + Date.now();
      const aadStr = API_VERSION + "|/mobile/v1/request|" + deviceId + "|" + timestamp + "|" + nonce;
      const aad = enc.encode(aadStr);

      const iv = PureCrypto.getRandomBytes(12);
      const plainBytes = enc.encode(JSON.stringify(payload));
      const { ciphertext, tag } = PureCrypto.aesGcmEncrypt(secretBuf, iv, plainBytes, aad);

      const reqEnvelope = {
        version: API_VERSION,
        iv: bufToB64Url(iv),
        ciphertext: bufToB64Url(ciphertext),
        tag: bufToB64Url(tag)
      };

      const res = await fetch(cred.endpoint + "/mobile/v1/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Mission-Control-Device": deviceId,
          "X-Mission-Control-Time": String(timestamp),
          "X-Mission-Control-Nonce": nonce
        },
        body: JSON.stringify(reqEnvelope)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const errText = String(err.error || err.message || "Request failed");
        if (res.status === 401 || res.status === 403 || errText.toLowerCase().includes("revoked") || errText.toLowerCase().includes("unknown")) {
          localStorage.removeItem(STORAGE_KEY);
          appState.data = null;
          appState.error = "Device session was revoked by desktop. Please re-pair.";
          render();
          throw new Error("Session expired or device was revoked by desktop.");
        }
        throw new Error(errText);
      }

      const sealed = await res.json();
      const resIv = b64UrlToBuf(sealed.iv);
      const resCipher = b64UrlToBuf(sealed.ciphertext);
      const resTag = b64UrlToBuf(sealed.tag);
      const resAad = enc.encode(aadStr + "|response");

      const decryptedBuf = PureCrypto.aesGcmDecrypt(secretBuf, resIv, resCipher, resTag, resAad);
      const opened = JSON.parse(new TextDecoder().decode(decryptedBuf));
      return opened.result;
    }

    // ---------------------------------------------------------------------------
    // SSE & Real-time Synchronization
    // ---------------------------------------------------------------------------
    function connectSSE() {
      if (appState.sse) {
        appState.sse.close();
        appState.sse = null;
      }
      try {
        const sse = new EventSource(window.location.origin + "/mobile/v1/events");
        sse.addEventListener("status", () => {
          refreshDashboard();
        });
        sse.addEventListener("open", () => {
          const statusBadge = document.getElementById("connectionStatus");
          if (statusBadge) {
            statusBadge.className = "status-badge is-live";
            statusBadge.innerHTML = "<i></i><span>Live</span>";
          }
        });
        sse.addEventListener("error", () => {
          const statusBadge = document.getElementById("connectionStatus");
          if (statusBadge) {
            statusBadge.className = "status-badge is-waiting";
            statusBadge.innerHTML = "<i></i><span>Syncing</span>";
          }
        });
        appState.sse = sse;
      } catch (err) {}
    }

    async function refreshDashboard(manual = false) {
      const cred = getStoredCredential();
      if (!cred) return;
      try {
        const data = await sendEncryptedRequest(cred, { operation: "snapshot" });
        
        // Detect and trigger active attention alerts
        const activeAttention = (data.attention || []).filter(item => item && item.state !== "recovered" && item.state !== "resolved" && item.state !== "dismissed");
        if (activeAttention.length > appState.previousAttentionCount && appState.data) {
          const newest = activeAttention[activeAttention.length - 1];
          triggerAlertNotification(
            "Needs You (" + activeAttention.length + ")",
            (newest?.sessionName || newest?.name || "Worker") + ": " + (newest?.reason || newest?.attentionReason || "Supervisor decision required"),
            "critical"
          );
        }
        appState.previousAttentionCount = activeAttention.length;

        appState.data = data;
        appState.caps = data.companion || null;
        appState.error = "";
        const statusBadge = document.getElementById("connectionStatus");
        if (statusBadge) {
          statusBadge.className = "status-badge is-live";
          statusBadge.innerHTML = "<i></i><span>Live</span>";
        }
        if (data.project?.name) {
          const sub = document.getElementById("headerSubtitle");
          if (sub) sub.innerText = data.project.name;
        }
        if (manual) SoundFx.beep("info");
      } catch (err) {
        appState.error = err.message;
        const statusBadge = document.getElementById("connectionStatus");
        if (statusBadge) {
          statusBadge.className = "status-badge is-offline";
          statusBadge.innerHTML = "<i></i><span>Offline</span>";
        }
      }
      renderActiveTab();
      updateBadges();
      refreshOpenDetail();
    }

    function updateBadges() {
      const d = appState.data;
      const attention = (d?.attention || []).filter(item => item && item.state !== "recovered" && item.state !== "resolved" && item.state !== "dismissed");
      const attentionCount = attention.length;
      const navBadgeNeeds = document.getElementById("navBadgeNeeds");
      const desktopNavBadgeNeeds = document.getElementById("desktopNavBadgeNeeds");
      const headerBadge = document.getElementById("headerBadge");
      if (navBadgeNeeds) {
        navBadgeNeeds.style.display = attentionCount > 0 ? "flex" : "none";
        navBadgeNeeds.innerText = String(attentionCount);
      }
      if (desktopNavBadgeNeeds) {
        desktopNavBadgeNeeds.style.display = attentionCount > 0 ? "inline-flex" : "none";
        desktopNavBadgeNeeds.innerText = String(attentionCount);
      }
      if (headerBadge) {
        headerBadge.style.display = attentionCount > 0 ? "block" : "none";
      }
    }

    function switchTab(tab) {
      appState.tab = tab;
      appState.lastHtml = "";
      document.querySelectorAll(".nav-tab").forEach(el => {
        el.classList.toggle("is-active", el.getAttribute("data-tab") === tab);
      });
      document.querySelectorAll(".desktop-nav-tab").forEach(el => {
        el.classList.toggle("is-active", el.getAttribute("data-tab") === tab);
      });
      renderActiveTab();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    // ---------------------------------------------------------------------------
    // Action Modals & Drawers
    // ---------------------------------------------------------------------------
    // One sheet serves every dialog. A refresh of the terminal sheet repaints it
    // in place: it keeps its scroll position and skips the write when nothing
    // changed, so a poll cannot snap the sheet back to the top under a thumb.
    function openActionModal(title, formHtml, options) {
      const keepScroll = Boolean(options && options.keepScroll);
      const sheet = document.querySelector("#actionModal .modal-sheet");
      const scrolled = keepScroll && sheet ? sheet.scrollTop : 0;
      document.getElementById("modalTitle").innerText = title;
      if (appState.modalHtml !== formHtml) {
        document.getElementById("modalBody").innerHTML = formHtml;
        appState.modalHtml = formHtml;
      }
      document.getElementById("actionModal").classList.add("is-open");
      if (sheet) sheet.scrollTop = scrolled;
    }
    function closeActionModal() {
      document.getElementById("actionModal").classList.remove("is-open");
      appState.modalHtml = "";
      appState.detail = null;
      appState.confirming = false;
    }
    // A confirmation sheet opened from a terminal's summary goes back to it.
    function backToDetail() {
      appState.confirming = false;
      if (appState.detail) showDetail();
      else closeActionModal();
    }

    // ---------------------------------------------------------------------------
    // What a request does, in words the phone can show
    // ---------------------------------------------------------------------------
    const WORKER_ACTIONS = ["start", "restart", "stop", "acknowledge"];
    const ACTION_COPY = {
      start: { title: "Start", busy: "Starting…", done: "started" },
      restart: { title: "Restart", busy: "Restarting…", done: "restarted" },
      stop: { title: "Stop", busy: "Stopping…", done: "stopped" },
      acknowledge: { title: "Acknowledge", busy: "Acknowledging…", done: "acknowledged" }
    };
    const RECIPE_ACTIONS = ["run", "recover", "cancel"];
    const RECIPE_COPY = {
      run: { title: "Run", busy: "Starting…", done: "is starting" },
      recover: { title: "Recover", busy: "Recovering…", done: "is recovering" },
      cancel: { title: "Cancel", busy: "Cancelling…", done: "was cancelled" }
    };

    // The desktop says which requests it runs without asking. Anything it does
    // not name waits for approval there, so an unknown answer means "waits".
    function isAutoAction(kind, action) {
      const caps = appState.caps;
      return Boolean(caps && caps.autoRun && caps.autoActions && (caps.autoActions[kind] || []).indexOf(action) !== -1);
    }
    function canControl() {
      return !appState.caps || appState.caps.canControl !== false;
    }
    function friendlyError(err) {
      const text = String((err && err.message) || err || "The request failed");
      if (/permission required/i.test(text)) return "This phone is not allowed to do that. Allow it on the desktop, then pair again.";
      return text;
    }

    // Says how a request ended. The desktop answers with the outcome: it ran,
    // it is waiting for approval there, or it failed and why.
    function reportOutcome(res, title, name, done) {
      const state = res && res.state;
      if (state === "approved") {
        SoundFx.beep("success");
        SoundFx.vibrate([60]);
        showToast(name + " " + done, "success");
        appendFeedItem({ kind: "action", title: title + " · " + name, detail: "Done from this phone" });
      } else if (state === "pending") {
        SoundFx.beep("info");
        showToast("Sent to your desktop. Approve “" + title.toLowerCase() + " " + name + "” there.", "warning");
        appendFeedItem({ kind: "action", title: title + " · " + name, detail: "Waiting for approval on the desktop" });
      } else if (state === "failed") {
        SoundFx.beep("alert");
        const reason = (res && res.error) || "the desktop refused it";
        showToast("Could not " + title.toLowerCase() + " " + name + ": " + reason, "critical");
        appendFeedItem({ kind: "alert", title: title + " failed · " + name, detail: reason });
      } else {
        showToast(title + " sent for " + name, "info");
      }
    }

    // Repaints whatever shows the busy state: the list behind, and the sheet.
    function repaintBusy() {
      renderActiveTab();
      if (appState.detail && !appState.confirming) showDetail();
    }

    // What restarting or stopping a terminal would disturb, from the desktop's
    // own dependency analysis.
    function impactNote(workerId) {
      const w = ((appState.data && appState.data.workers) || []).find(item => item.id === workerId);
      const impact = w && w.dependencyImpact;
      const n = impact ? Number(impact.downstreamCount) || 0 : 0;
      return n === 1 ? " 1 other terminal depends on it." : n > 1 ? " " + n + " other terminals depend on it." : "";
    }

    // ---------------------------------------------------------------------------
    // Terminal requests
    // ---------------------------------------------------------------------------
    function promptWorkerAction(workerId, action, defaultName) {
      if (!WORKER_ACTIONS.includes(action)) return;
      const name = defaultName || workerId;
      // Starting and acknowledging change nothing that is running: one tap.
      // Restart and stop end what is running, so they ask once, here on the
      // phone, before anything is sent.
      if (action === "start" || action === "acknowledge") { submitWorkerAction(workerId, action, name); return; }
      const auto = isAutoAction("worker", action);
      appState.confirming = true;
      const html = \`
        <div class="confirm">
          <p>\${auto
            ? "<strong>" + esc(name) + "</strong> " + (action === "restart" ? "restarts right away" : "stops right away") + ". Your desktop is not asked." + esc(impactNote(workerId))
            : "Your desktop will ask you to approve this before anything happens." + esc(impactNote(workerId))}</p>
          \${auto ? "" : \`<div class="input-group">
            <label>Note for the desktop (optional)</label>
            <input id="actionReason" type="text" maxlength="200" value="\${esc("Mobile: " + action)}">
          </div>\`}
          <div class="confirm-actions">
            <button class="btn btn-secondary" onclick="backToDetail()">Cancel</button>
            <button class="btn \${action === "stop" ? "btn-danger" : ""}" id="btnSubmitAction" data-id="\${esc(workerId)}" data-action="\${esc(action)}" data-name="\${esc(name)}" onclick="submitWorkerAction(this.dataset.id, this.dataset.action, this.dataset.name)">\${esc(auto ? ACTION_COPY[action].title + " now" : "Ask desktop")}</button>
          </div>
        </div>
      \`;
      openActionModal(ACTION_COPY[action].title + " " + name + "?", html);
    }

    async function submitWorkerAction(workerId, action, name) {
      const cred = getStoredCredential();
      if (!cred) return;
      const key = "worker:" + workerId;
      if (appState.busy[key]) return;
      const label = name || workerId;
      const copy = ACTION_COPY[action];
      const note = document.getElementById("actionReason");
      const reason = (note && note.value) || "Mobile: " + action;
      appState.busy[key] = copy.busy;
      backToDetail();
      repaintBusy();
      try {
        const res = await sendEncryptedRequest(cred, { operation: "request-worker-action", workerId: workerId, action: action, reason: reason });
        reportOutcome(res, copy.title, label, copy.done);
      } catch (err) {
        SoundFx.beep("alert");
        showToast(friendlyError(err), "critical");
      } finally {
        delete appState.busy[key];
      }
      repaintBusy();
      refreshDashboard();
    }

    // ---------------------------------------------------------------------------
    // Recipe requests
    // ---------------------------------------------------------------------------
    function promptRecipeAction(recipeId, action, defaultName) {
      if (!RECIPE_ACTIONS.includes(action)) return;
      const d = appState.data || {};
      const recipe = (d.recipes || []).find(item => item.id === recipeId);
      const names = {};
      (d.workers || []).forEach(w => { names[w.id] = w.name || w.id; });
      const order = recipe ? (recipe.steps || []).map(step => names[step.workerId] || step.workerId) : [];
      const name = defaultName || (recipe && recipe.name) || recipeId;
      const auto = isAutoAction("recipe", action);
      const what = action === "run"
        ? "Starts " + order.length + " terminal" + (order.length === 1 ? "" : "s") + " in order: " + order.join(" → ") + "."
        : action === "recover"
          ? "Picks the last failed run back up where it stopped."
          : "Stops the run that is in progress. Terminals it already started keep running.";
      appState.confirming = true;
      const html = \`
        <div class="confirm">
          <p>\${esc(what)} \${esc(auto ? "It starts right away. Your desktop is not asked." : "Your desktop will ask you to approve this first.")}</p>
          \${auto ? "" : \`<div class="input-group">
            <label>Note for the desktop (optional)</label>
            <input id="actionReason" type="text" maxlength="200" value="\${esc("Mobile: " + action + " " + name)}">
          </div>\`}
          <div class="confirm-actions">
            <button class="btn btn-secondary" onclick="backToDetail()">Cancel</button>
            <button class="btn \${action === "cancel" ? "btn-danger" : ""}" id="btnSubmitRecipe" data-id="\${esc(recipeId)}" data-action="\${esc(action)}" data-name="\${esc(name)}" onclick="submitRecipeAction(this.dataset.id, this.dataset.action, this.dataset.name)">\${esc(auto ? RECIPE_COPY[action].title + " now" : "Ask desktop")}</button>
          </div>
        </div>
      \`;
      openActionModal(RECIPE_COPY[action].title + " " + name + "?", html);
    }

    async function submitRecipeAction(recipeId, action, name) {
      const cred = getStoredCredential();
      if (!cred) return;
      const key = "recipe:" + recipeId;
      if (appState.busy[key]) return;
      const label = name || recipeId;
      const copy = RECIPE_COPY[action];
      const note = document.getElementById("actionReason");
      const reason = (note && note.value) || "Mobile: " + action + " " + label;
      appState.busy[key] = copy.busy;
      closeActionModal();
      renderActiveTab();
      try {
        const res = await sendEncryptedRequest(cred, { operation: "request-recipe-action", recipeId: recipeId, action: action, reason: reason });
        reportOutcome(res, copy.title, label, copy.done);
      } catch (err) {
        SoundFx.beep("alert");
        showToast(friendlyError(err), "critical");
      } finally {
        delete appState.busy[key];
      }
      renderActiveTab();
      refreshDashboard();
    }

    // ---------------------------------------------------------------------------
    // A terminal's summary sheet
    // ---------------------------------------------------------------------------
    function detailWorker() {
      const detail = appState.detail;
      if (!detail || !appState.data) return null;
      return (appState.data.workers || []).find(w => w.id === detail.id) || null;
    }
    function showDetail() {
      const w = detailWorker();
      if (!w) { closeActionModal(); return; }
      openActionModal(w.name || w.id, renderWorkerDetail(appState.data, w, appState.detail.output), { keepScroll: true });
    }
    function openWorkerDetail(workerId) {
      if (!appState.data) return;
      appState.confirming = false;
      appState.detail = { id: workerId, output: { state: "loading", lines: [], at: 0 } };
      appState.modalHtml = "";
      showDetail();
      loadDetailOutput(workerId);
    }
    // The summary itself comes from the dashboard's data. The terminal's last
    // lines are a separate read, and the desktop tells the phone when it is not
    // allowed to show them, which is not an error.
    async function loadDetailOutput(workerId) {
      const cred = getStoredCredential();
      if (!cred) return;
      const previous = appState.detail && appState.detail.id === workerId ? appState.detail.output : null;
      let output;
      try {
        const res = await sendEncryptedRequest(cred, { operation: "worker", workerId: workerId });
        const w = (res && res.worker) || {};
        output = res && res.outputAllowed === false
          ? { state: "off", lines: [], at: 0 }
          : { state: "ok", lines: Array.isArray(w.recentOutput) ? w.recentOutput : [], at: w.lastOutputAt || 0 };
      } catch (err) {
        // A dropped poll should not wipe the lines already shown.
        output = previous && previous.state === "ok" ? previous : { state: "error", lines: [], at: 0, message: friendlyError(err) };
      }
      // The sheet may have been closed, or moved to another terminal, while the read was out.
      if (!appState.detail || appState.detail.id !== workerId) return;
      appState.detail.output = output;
      if (!appState.confirming) showDetail();
    }
    function refreshOpenDetail() {
      if (!appState.detail || appState.confirming) return;
      if (!detailWorker()) {
        closeActionModal();
        showToast("That terminal is no longer in this project", "warning");
        return;
      }
      loadDetailOutput(appState.detail.id);
    }
    function setWorkersView(view) {
      appState.workersView = view === "recipes" ? "recipes" : "terminals";
      renderActiveTab();
    }
    function openRecipes() {
      appState.workersView = "recipes";
      switchTab("workers");
    }

    // ---------------------------------------------------------------------------
    // View Rendering Functions
    // ---------------------------------------------------------------------------
    // ---------------------------------------------------------------------------
    // Terminals: how a worker reads on a phone
    // ---------------------------------------------------------------------------
    // One state per worker. The desktop sends "state" (running, needs-you,
    // failed...); "status" is read as well so an older payload still shows.
    const WORKER_STATES = {
      running: { label: "Running", tone: "running" },
      working: { label: "Working", tone: "running" },
      starting: { label: "Starting", tone: "warning" },
      waiting: { label: "Waiting", tone: "warning" },
      "needs-you": { label: "Needs you", tone: "warning" },
      failed: { label: "Failed", tone: "critical" },
      completed: { label: "Finished", tone: "idle" },
      stopped: { label: "Stopped", tone: "idle" }
    };
    function workerView(w) {
      const alive = w.isAlive === true || w.status === "running";
      let key = String(w.state || "");
      if (!WORKER_STATES[key]) key = w.status === "failed" ? "failed" : alive ? "running" : "stopped";
      const info = WORKER_STATES[key];
      return { key: key, label: info.label, tone: info.tone, alive: alive };
    }
    function fmtDuration(ms) {
      const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
      if (s < 60) return s + "s";
      const m = Math.floor(s / 60);
      if (m < 60) return m + "m";
      const h = Math.floor(m / 60);
      if (h < 24) return h + "h " + (m % 60) + "m";
      return Math.floor(h / 24) + "d " + (h % 24) + "h";
    }
    function ago(ts) {
      if (!ts) return "never";
      const s = Math.floor((Date.now() - Number(ts)) / 1000);
      return s < 5 ? "just now" : fmtDuration(s * 1000) + " ago";
    }
    // Terminal lines are text. Escape sequences and control characters that a
    // terminal would have interpreted are dropped, not shown as boxes.
    const ANSI_PATTERN = new RegExp(String.fromCharCode(27) + "\\\\[[0-9;?]*[ -/]*[@-~]", "g");
    const CONTROL_PATTERN = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(8) + String.fromCharCode(11) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "]", "g");
    function plainLine(line) {
      return String(line == null ? "" : line).replace(ANSI_PATTERN, "").replace(CONTROL_PATTERN, "");
    }

    // The one sentence that answers "what is this doing?", built from what the
    // desktop reported, not from the terminal's text.
    function workerHeadline(w, view) {
      const reason = w.attention && w.attention.required ? (w.attention.reason || "Operator review is required.") : "";
      if (view.key === "needs-you") return "Waiting for you: " + reason;
      if (view.key === "failed") return "Failed" + (Number.isInteger(w.exitCode) ? " with exit code " + w.exitCode : "") + ". " + (reason || "Restart it, or read the last output below.");
      if (view.key === "starting") return "Starting up.";
      if (view.alive) return "Running for " + fmtDuration(w.runtimeMs) + ".";
      if (view.key === "completed") return "Finished successfully.";
      return "Not running.";
    }
    function workerFacts(w, view) {
      const facts = [];
      facts.push(["Last output", ago(w.lastOutputAt), ""]);
      if (!view.alive && Number.isInteger(w.exitCode)) facts.push(["Exit code", String(w.exitCode), ""]);
      const r = w.resources;
      if (r && r.available) {
        if (r.cpuPercent != null && Number.isFinite(Number(r.cpuPercent))) facts.push(["CPU", Math.round(Number(r.cpuPercent)) + "%", ""]);
        if (r.memoryMB != null && Number.isFinite(Number(r.memoryMB))) facts.push(["Memory", Math.round(Number(r.memoryMB)) + " MB", ""]);
      }
      const impact = w.dependencyImpact;
      if (impact && Number(impact.recipeCount) > 0) facts.push(["In recipes", String(impact.recipeCount), ""]);
      if (impact && Number(impact.downstreamCount) > 0) facts.push(["Others depend on it", String(impact.downstreamCount), ""]);
      if (w.command) facts.push(["Command", w.command + (w.args && w.args.length ? " " + w.args.join(" ") : ""), "wide mono"]);
      if (w.cwd) facts.push(["Folder", w.cwd, "wide mono"]);
      return facts;
    }
    // What the desktop has seen this terminal do: tests, a build, a service
    // coming up, a branch. Only what it actually reported is shown.
    function workerSignals(w) {
      const e = w.evidence || {};
      const out = [];
      const has = value => value != null && value !== "";
      if (e.tests) {
        const failed = Number(e.tests.failed) || 0;
        if (has(e.tests.passed) || failed) out.push({ label: "Tests", value: (Number(e.tests.passed) || 0) + " passed" + (failed ? " · " + failed + " failed" : ""), tone: failed ? "critical" : "running" });
      }
      if (e.build) out.push({ label: "Build", value: String(e.build.phase || (Number(e.build.durationMs) ? "done in " + fmtDuration(e.build.durationMs) : "seen")), tone: e.build.phase === "failed" ? "critical" : "idle" });
      if (e.service) {
        const where = e.service.port ? "port " + e.service.port : e.service.origin;
        out.push({ label: "Service", value: [where, e.service.health].filter(has).join(" · ") || "seen", tone: e.service.health === "failed" ? "critical" : e.service.health === "confirmed" ? "running" : "idle" });
      }
      if (e.git) out.push({ label: "Git", value: [e.git.branch, e.git.clean === true ? "clean" : Number(e.git.changedPaths) ? e.git.changedPaths + " changes" : ""].filter(has).join(" · ") || "active", tone: "idle" });
      if (e.database) out.push({ label: "Database", value: [e.database.connection, has(e.database.migrations) ? "migrations " + e.database.migrations : ""].filter(has).join(" · ") || "seen", tone: e.database.connection === "failed" ? "critical" : "idle" });
      if (e.container) out.push({ label: "Container", value: [e.container.state, e.container.image].filter(has).join(" · ") || "seen", tone: e.container.healthy === false ? "critical" : "idle" });
      return out;
    }

    function noControlNote() {
      return '<p class="msg info">This phone can watch but not control. Turn on “Control workers &amp; recipes” on the desktop, then pair this phone again.</p>';
    }
    // Start, or restart and stop, for one terminal. While a request is out the
    // buttons become one disabled button that says what is happening.
    function workerButtons(w, view) {
      const busy = appState.busy["worker:" + w.id];
      if (busy) return '<button class="action-btn primary" disabled>' + esc(busy) + '</button>';
      const off = canControl() ? "" : " disabled";
      const name = w.name || w.id;
      const btn = (action, cls, label) => '<button class="action-btn ' + cls + '" ' + workerActionAttrs(w.id, action, name) + off + '>' + esc(label) + '</button>';
      return view.alive ? btn("restart", "", "Restart") + btn("stop", "danger", "Stop") : btn("start", "primary", "Start");
    }

    // ---------------------------------------------------------------------------
    // The summary sheet for one terminal
    // ---------------------------------------------------------------------------
    function renderWorkerDetail(d, w, output) {
      const view = workerView(w);
      const name = w.name || w.id;
      // The output caption already says when it last printed.
      const shownAbove = Boolean(output && output.state === "ok" && output.at);
      const facts = workerFacts(w, view).filter(fact => !(shownAbove && fact[0] === "Last output"));
      const signals = workerSignals(w);
      const health = w.health && w.health.summary
        ? '<div class="health-note"><strong>' + esc(w.health.label || "Health") + '.</strong> ' + esc(w.health.summary) + '</div>'
        : "";
      let out;
      if (!output || output.state === "loading") out = '<div class="term-empty">Reading the terminal…</div>';
      else if (output.state === "off") out = '<div class="term-empty">Terminal output is off for this phone. Allow “Terminal Evidence” on the desktop, then pair again to see it here.</div>';
      else if (output.state === "error") out = '<div class="term-empty">' + esc(output.message || "Could not read the terminal.") + '</div>';
      else {
        const lines = (output.lines || []).map(plainLine).filter(line => line.trim());
        out = lines.length ? '<pre class="term-out">' + esc(lines.join(NL)) + '</pre>' : '<div class="term-empty">This terminal has not printed anything yet.</div>';
      }
      const caption = output && output.state === "ok" && output.at ? "Last output · " + ago(output.at) : "Last output";
      const attention = w.attention && w.attention.required;
      const acknowledge = attention && !appState.busy["worker:" + w.id]
        ? '<button class="action-btn warn" ' + workerActionAttrs(w.id, "acknowledge", name) + (canControl() ? "" : " disabled") + '>Acknowledge</button>'
        : "";
      const explain = canAsk(getStoredCredential())
        ? '<button class="action-btn" data-name="' + esc(name) + '" onclick="explainWorker(this.dataset.name)">Explain with Mission AI</button>'
        : "";
      return \`
        <div class="detail">
          <div class="detail-head">
            <span class="pill \${view.tone}"><i></i>\${esc(view.label)}</span>
            <span class="detail-role">\${esc(w.role || "terminal")}</span>
          </div>
          <p class="detail-headline">\${esc(workerHeadline(w, view))}</p>
          \${view.alive && w.currentActivity ? '<p class="detail-now">' + esc(w.currentActivity) + '</p>' : ""}
          \${signals.length ? '<div class="signal-row">' + signals.map(s => '<span class="signal ' + s.tone + '"><small>' + esc(s.label) + '</small>' + esc(s.value) + '</span>').join("") + '</div>' : ""}
          \${health}
          <div class="term-block">
            <small class="term-cap">\${esc(caption)}</small>
            \${out}
          </div>
          <div class="fact-grid">\${facts.map(fact => '<div class="' + esc(fact[2]) + '"><small>' + esc(fact[0]) + '</small><b class="' + esc(fact[2]) + '">' + esc(fact[1]) + '</b></div>').join("")}</div>
          \${canControl() ? "" : noControlNote()}
          <div class="detail-actions">\${workerButtons(w, view)}\${acknowledge}\${explain}</div>
        </div>
      \`;
    }
    function explainWorker(name) {
      closeActionModal();
      switchTab("ask");
      askSuggestion("Summarize " + name + ": what is it doing right now, and is anything wrong with it?");
    }

    // A terminal in a list. The whole card opens its summary; the buttons on it
    // act without opening anything.
    function terminalCard(w) {
      const view = workerView(w);
      const name = w.name || w.id;
      const attention = w.attention && w.attention.required ? (w.attention.reason || "Operator review is required.") : "";
      const line = attention
        || (view.key === "failed" ? "Failed" + (Number.isInteger(w.exitCode) ? " · exit code " + w.exitCode : "")
          : view.alive ? "Running for " + fmtDuration(w.runtimeMs)
          : view.key === "completed" ? "Finished successfully" : "Not running");
      const lineClass = attention ? " is-alert" : view.key === "failed" ? " is-critical" : "";
      return \`
        <div class="term-card is-\${view.tone}" data-id="\${esc(w.id)}" onclick="openWorkerDetail(this.dataset.id)">
          <div class="term-top">
            <div class="item-info">
              <strong>\${esc(name)}</strong>
              <small>\${esc(w.command ? w.command + (w.args && w.args.length ? " " + w.args.join(" ") : "") : "Process")}</small>
            </div>
            <span class="pill \${view.tone}"><i></i>\${esc(view.label)}</span>
          </div>
          <p class="term-line\${lineClass}">\${esc(line)}</p>
          <div class="term-foot">
            <button type="button" class="term-open" data-id="\${esc(w.id)}" aria-label="\${esc("Summary of " + name)}" onclick="event.stopPropagation(); openWorkerDetail(this.dataset.id)">\${esc(w.role || "terminal")} · Summary ›</button>
            <div class="term-actions" onclick="event.stopPropagation()">\${workerButtons(w, view)}</div>
          </div>
        </div>
      \`;
    }

    // ---------------------------------------------------------------------------
    // Recipes
    // ---------------------------------------------------------------------------
    const RECIPE_PHASES = {
      running: ["Running", "running"], paused: ["Paused", "warning"], cancelling: ["Cancelling", "warning"],
      failed: ["Failed", "critical"], completed: ["Done", "running"], cancelled: ["Cancelled", "idle"]
    };
    function recipeView(r) {
      const phase = r.run ? String(r.run.phase || "") : "";
      const info = RECIPE_PHASES[phase] || ["Ready", "idle"];
      return { phase: phase, active: phase === "running" || phase === "paused" || phase === "cancelling", failed: phase === "failed", label: info[0], tone: info[1] };
    }
    function stepClass(phase) {
      if (phase === "ready" || phase === "completed" || phase === "done") return " is-ok";
      if (phase === "failed" || phase === "blocked") return " is-bad";
      if (phase === "starting" || phase === "running" || phase === "waiting" || phase === "retrying") return " is-busy";
      return "";
    }
    function recipeButtons(r, view) {
      const busy = appState.busy["recipe:" + r.id];
      if (busy) return '<button class="action-btn primary" disabled>' + esc(busy) + '</button>';
      const off = canControl() ? "" : " disabled";
      const attrs = action => 'data-id="' + esc(r.id) + '" data-action="' + action + '" data-name="' + esc(r.name || r.id) + '" onclick="promptRecipeAction(this.dataset.id, this.dataset.action, this.dataset.name)"';
      if (view.active) return '<button class="action-btn danger" ' + attrs("cancel") + off + '>Cancel run</button>';
      if (view.failed) return '<button class="action-btn primary" ' + attrs("recover") + off + '>Recover</button><button class="action-btn" ' + attrs("run") + off + '>Run again</button>';
      return '<button class="action-btn primary" ' + attrs("run") + off + '>Run recipe</button>';
    }
    function renderRecipeCard(r, names) {
      const view = recipeView(r);
      const steps = r.steps || [];
      const run = r.run || null;
      const states = (run && run.stepStates) || {};
      const failure = view.failed && run && run.failures && run.failures[0]
        ? '<p class="recipe-fail">' + esc((names[run.failures[0].workerId] || run.failures[0].workerId || "A step") + ": " + (run.failures[0].reason || "failed")) + '</p>'
        : "";
      const when = run && (run.finishedAt || run.startedAt) ? " · " + (run.finishedAt ? "finished " : "started ") + ago(run.finishedAt || run.startedAt) : "";
      return \`
        <div class="card recipe-card">
          <div class="recipe-head">
            <div class="item-info">
              <strong>\${esc(r.name || r.id)}</strong>
              <small>\${steps.length} terminal\${steps.length === 1 ? "" : "s"}\${esc(when)}</small>
            </div>
            <span class="pill \${view.tone}"><i></i>\${esc(view.label)}</span>
          </div>
          <ol class="recipe-steps">\${steps.map(step => {
            const after = (step.dependsOn || []).map(id => names[id] || id).join(", ");
            return '<li class="' + stepClass(states[step.workerId] && states[step.workerId].phase).trim() + '"><i></i><b>' + esc(names[step.workerId] || step.workerId) + '</b>' + (after ? '<small>after ' + esc(after) + '</small>' : "") + '</li>';
          }).join("")}</ol>
          \${failure}
          <div class="recipe-actions">\${recipeButtons(r, view)}</div>
        </div>
      \`;
    }
    function renderRecipesView(d) {
      const recipes = d.recipes || [];
      if (!recipes.length) {
        return '<div class="card"><p class="msg">No recipes in this project yet. Build one under Recipes on the desktop and it will show up here, ready to run.</p></div>';
      }
      const names = {};
      (d.workers || []).forEach(w => { names[w.id] = w.name || w.id; });
      return (canControl() ? "" : noControlNote()) + '<div class="item-list">' + recipes.map(r => renderRecipeCard(r, names)).join("") + '</div>';
    }

    // ---------------------------------------------------------------------------
    // Tabs
    // ---------------------------------------------------------------------------
    function attentionOf(d) {
      return (d.attention || []).filter(item => item && item.state !== "recovered" && item.state !== "resolved" && item.state !== "dismissed");
    }
    // Trouble first, then what is running, then what is idle.
    function workerRank(w) {
      const key = workerView(w).key;
      return key === "failed" ? 0 : key === "needs-you" ? 1 : workerView(w).alive ? 2 : 3;
    }

    function renderOverviewTab(d) {
      const workers = d.workers || [];
      const running = workers.filter(w => workerView(w).alive).length;
      const attention = attentionOf(d);
      const recipes = d.recipes || [];
      const chapters = d.projectMemory?.chapters || [];

      const healthState = attention.length > 0 ? "needs-attention" : workers.some(w => w.health?.tone === "pressure") ? "degraded" : "healthy";
      const spotlight = [...workers].sort((a, b) => workerRank(a) - workerRank(b)).slice(0, 4);

      return \`
        <div class="system-health-banner">
          <div class="system-health-status">
            <div class="system-health-dot \${healthState === 'needs-attention' ? 'is-danger' : healthState === 'degraded' ? 'is-warn' : ''}"></div>
            <div class="system-health-title">
              <strong>\${healthState === 'needs-attention' ? 'Attention Required' : healthState === 'degraded' ? 'System Degraded' : 'All Systems Nominal'}</strong>
              <small>\${esc(d.project?.name || 'Workspace')} · \${running} of \${workers.length} workers active</small>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title"><span>System Telemetry</span><span class="badge">\${esc(d.project?.name || 'Workspace')}</span></div>
          <div class="telemetry-grid">
            <div class="telemetry-tile" onclick="switchTab('workers')">
              <b style="color:var(--ok)">\${running}/\${workers.length}</b>
              <small>Active Workers</small>
            </div>
            <div class="telemetry-tile" onclick="switchTab('needs')">
              <b style="color:\${attention.length ? 'var(--danger)' : 'var(--text)'}">\${attention.length}</b>
              <small>Needs You</small>
            </div>
            <div class="telemetry-tile" onclick="openRecipes()">
              <b style="color:var(--primary)">\${recipes.length}</b>
              <small>Recipes</small>
            </div>
            <div class="telemetry-tile" onclick="switchTab('memory')">
              <b style="color:var(--purple)">\${chapters.length}</b>
              <small>Memories</small>
            </div>
          </div>
        </div>

        \${attention.length > 0 ? \`
          <div class="card" style="border-color:var(--warn-border);background:rgba(251,191,36,0.05);">
            <div class="card-title" style="color:var(--warn)"><span>Needs Attention (\${attention.length})</span><span class="badge" style="background:rgba(251,191,36,0.2);color:var(--warn)">BLOCKER</span></div>
            <div class="item-list">
              \${attention.map(item => {
                const targetId = item.workerId || item.sessionId || item.id;
                const targetName = item.sessionName || item.name || targetId;
                const reasonText = item.reason || item.attentionReason || 'Decision required';
                return \`
                <div class="item-row">
                  <div class="item-info">
                    <strong>\${esc(targetName)}</strong>
                    <small style="color:var(--danger)">\${esc(reasonText)}</small>
                  </div>
                  <button class="action-btn warn" onclick="switchTab('needs')">Review</button>
                </div>
              \`; }).join('')}
            </div>
          </div>
        \` : ''}

        <div class="card">
          <div class="card-title"><span>Terminals</span><span class="badge" onclick="switchTab('workers')" style="cursor:pointer">VIEW ALL</span></div>
          <div class="item-list">
            \${spotlight.length === 0 ? '<p class="msg">No terminals in this project yet.</p>' : spotlight.map(terminalCard).join('')}
          </div>
        </div>

        \${recipes.length > 0 ? \`
          <div class="card">
            <div class="card-title"><span>Recipes</span><span class="badge" onclick="openRecipes()" style="cursor:pointer">VIEW ALL</span></div>
            <div class="item-list">
              \${recipes.slice(0, 3).map(r => {
                const view = recipeView(r);
                return \`
                <div class="item-row">
                  <div class="item-info">
                    <strong>\${esc(r.name || r.id)}</strong>
                    <small>\${(r.steps || []).length} terminal\${(r.steps || []).length === 1 ? '' : 's'}</small>
                  </div>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span class="pill \${view.tone}"><i></i>\${esc(view.label)}</span>
                    \${recipeButtons(r, view)}
                  </div>
                </div>
              \`; }).join('')}
            </div>
          </div>
        \` : ''}

        <div class="card" style="display:flex;gap:10px;">
          <button class="btn btn-secondary" onclick="refreshDashboard(true)" style="flex:1;">Refresh Telemetry</button>
        </div>
      \`;
    }

    function renderWorkersTab(d) {
      const workers = d.workers || [];
      const recipes = d.recipes || [];
      const filter = appState.workerFilter;
      const search = (appState.searchQuery || "").toLowerCase();
      const recipesView = appState.workersView === "recipes";

      const segmented = \`
        <div class="segmented" role="tablist" aria-label="Terminals or recipes">
          <button role="tab" aria-selected="\${!recipesView}" class="\${recipesView ? '' : 'is-active'}" onclick="setWorkersView('terminals')">Terminals<b>\${workers.length}</b></button>
          <button role="tab" aria-selected="\${recipesView}" class="\${recipesView ? 'is-active' : ''}" onclick="setWorkersView('recipes')">Recipes<b>\${recipes.length}</b></button>
        </div>
      \`;
      if (recipesView) return segmented + renderRecipesView(d);

      const filtered = workers.filter(w => {
        const view = workerView(w);
        if (filter === "running" && !view.alive) return false;
        if (filter === "attention" && view.key !== "failed" && view.key !== "needs-you" && !(w.attention && w.attention.required)) return false;
        if (filter === "idle" && view.alive) return false;
        if (search && !(w.name || w.id).toLowerCase().includes(search) && !(w.command || "").toLowerCase().includes(search)) return false;
        return true;
      }).sort((a, b) => workerRank(a) - workerRank(b));

      return \`
        \${segmented}
        <div class="filter-bar">
          <div class="filter-chip \${filter === 'all' ? 'is-active' : ''}" onclick="setWorkerFilter('all')">All (\${workers.length})</div>
          <div class="filter-chip \${filter === 'running' ? 'is-active' : ''}" onclick="setWorkerFilter('running')">Running</div>
          <div class="filter-chip \${filter === 'attention' ? 'is-active' : ''}" onclick="setWorkerFilter('attention')">Attention</div>
          <div class="filter-chip \${filter === 'idle' ? 'is-active' : ''}" onclick="setWorkerFilter('idle')">Idle</div>
        </div>

        <div class="search-box">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" placeholder="Search terminals by name or command…" value="\${esc(appState.searchQuery)}" oninput="setSearchQuery(this.value)">
        </div>

        <div class="card">
          <div class="card-title"><span>Terminals (\${filtered.length})</span><span class="badge">TAP FOR SUMMARY</span></div>
          \${canControl() ? "" : noControlNote()}
          <div class="item-list">
            \${filtered.length === 0 ? '<p class="msg">No matching terminals found.</p>' : filtered.map(terminalCard).join('')}
          </div>
        </div>
      \`;
    }

    function renderNeedsTab(d) {
      const attention = attentionOf(d);
      const known = {};
      (d.workers || []).forEach(w => { known[w.id] = true; });
      return \`
        <div class="card" style="\${attention.length ? 'border-color:var(--danger-border);' : ''}">
          <div class="card-title"><span>Needs You Queue (\${attention.length})</span><span class="badge">DECISION</span></div>
          \${attention.length === 0 ? \`
            <div style="text-align:center;padding:36px 0;">
              <div style="width:48px;height:48px;border-radius:50%;background:var(--ok-soft);border:1px solid var(--ok-border);display:grid;place-items:center;margin:0 auto 12px;color:var(--ok);">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>
              </div>
              <p style="font-size:15px;color:var(--ok);font-weight:800;">All Clear</p>
              <p style="font-size:12.5px;color:var(--text-muted);margin-top:4px;">No workers currently require human supervision or decisions.</p>
            </div>
          \` : \`
            <div class="item-list">
              \${attention.map(item => {
                const targetId = item.workerId || item.sessionId || item.id;
                const targetName = item.sessionName || item.name || targetId;
                const reasonText = item.reason || item.attentionReason || 'Worker encountered an issue and requires decision';
                const busy = appState.busy["worker:" + targetId];
                const off = busy || !canControl() ? " disabled" : "";
                return \`
                <div class="item-row" style="flex-direction:column;align-items:stretch;gap:12px;">
                  <div class="item-info">
                    <strong>\${esc(targetName)}</strong>
                    <p style="font-size:13px;color:var(--danger);margin-top:4px;font-weight:600;">\${esc(reasonText)}</p>
                    <small style="color:var(--text-dim);margin-top:4px;">Target ID: \${esc(targetId)}</small>
                  </div>
                  <div style="display:flex;gap:8px;">
                    <button class="action-btn primary" style="flex:1;" \${workerActionAttrs(targetId, 'restart', targetName)}\${off}>\${esc(busy || 'Restart')}</button>
                    <button class="action-btn" style="flex:1;" \${workerActionAttrs(targetId, 'acknowledge', targetName)}\${off}>Acknowledge</button>
                    \${known[targetId] ? '<button class="action-btn" style="flex:1;" data-id="' + esc(targetId) + '" onclick="openWorkerDetail(this.dataset.id)">Summary</button>' : ''}
                  </div>
                </div>
              \`; }).join('')}
            </div>
          \`}
        </div>
      \`;
    }

    function renderMemoryTab(d) {
      const chapters = d.projectMemory?.chapters || [];
      const search = (appState.searchQuery || "").toLowerCase();
      const filtered = chapters.filter(ch => {
        if (!search) return true;
        return (ch.title || "").toLowerCase().includes(search) || (ch.summary || ch.content || "").toLowerCase().includes(search);
      });

      return \`
        <div class="search-box">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" placeholder="Search project memory chapters…" value="\${esc(appState.searchQuery)}" oninput="setSearchQuery(this.value)">
        </div>

        <div class="card">
          <div class="card-title"><span>Project Memory (\${filtered.length})</span><span class="badge">PERSISTENT</span></div>
          \${filtered.length === 0 ? '<p class="msg">No project memory chapters recorded yet.</p>' : \`
            <div class="item-list">
              \${filtered.map(ch => \`
                <div class="memory-chapter">
                  <strong>\${esc(ch.title || ch.id || 'Session Record')}</strong>
                  <p>\${esc(ch.summary || ch.content || 'Memory details')}</p>
                </div>
              \`).join('')}
            </div>
          \`}
        </div>
      \`;
    }

    function renderFeedTab() {
      const items = getFeedItems();
      return \`
        <div class="card">
          <div class="card-title">
            <span>Activity & Notifications Feed</span>
            <button class="action-btn" onclick="clearFeed()" style="padding:3px 8px;font-size:10px;">Clear</button>
          </div>
          \${items.length === 0 ? '<p class="msg">No activity events logged yet.</p>' : \`
            <div class="item-list">
              \${items.map(item => \`
                <div class="feed-item">
                  <div class="feed-icon \${item.kind === 'alert' ? 'alert' : item.kind === 'action' ? 'action' : 'system'}">
                    \${item.kind === 'alert' ? '!' : item.kind === 'action' ? '⚡' : 'i'}
                  </div>
                  <div class="feed-body">
                    <strong>\${esc(item.title)}</strong>
                    <p style="font-size:12px;color:var(--text-muted);margin-top:2px;">\${esc(item.detail)}</p>
                    <small>\${new Date(item.at).toLocaleTimeString()}</small>
                  </div>
                </div>
              \`).join('')}
            </div>
          \`}
        </div>
      \`;
    }

    // What the desktop lets this phone do with terminals and recipes right now.
    function controlSummary() {
      const caps = appState.caps;
      if (!caps) return "Checking with the desktop…";
      if (!caps.canControl) return "Not allowed for this phone. Turn on “Control workers & recipes” on the desktop, then pair again.";
      return caps.autoRun
        ? "Start, restart and recipe runs go straight through. Stop and cancel ask your desktop first."
        : "Every request waits for your approval on the desktop.";
    }
    function renderSettingsTab(cred) {
      const prefs = getPreferences();
      const notifStatus = "Notification" in window ? Notification.permission : "unsupported";

      return \`
        <div class="card">
          <div class="card-title"><span>Device & Security</span><span class="badge">X25519 · AES-GCM</span></div>
          <div class="item-list">
            <div class="item-row">
              <div class="item-info">
                <strong>Device Name</strong>
                <small>\${esc(cred.deviceName || 'Mobile Phone')}</small>
              </div>
            </div>
            <div class="item-row">
              <div class="item-info">
                <strong>Gateway Endpoint</strong>
                <small>\${esc(cred.endpoint)}</small>
              </div>
            </div>
            <div class="item-row">
              <div class="item-info">
                <strong>Active Scopes</strong>
                <small>\${esc((cred.scopes || []).join(', ') || 'Standard scopes')}</small>
              </div>
            </div>
            <div class="item-row">
              <div class="item-info">
                <strong>Ask Mission AI</strong>
                <small class="wrap">\${canAsk(cred) ? 'Allowed — read-only answers from the desktop' : 'Not allowed for this phone. Turn it on on the desktop, then pair again.'}</small>
              </div>
            </div>
            <div class="item-row">
              <div class="item-info">
                <strong>Control from this phone</strong>
                <small class="wrap">\${esc(controlSummary())}</small>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title"><span>Companion Preferences</span></div>
          <div class="item-list">
            <div class="item-row">
              <div class="item-info">
                <strong>Audio Alerts</strong>
                <small>Synthesizer chimes on events and decisions</small>
              </div>
              <input type="checkbox" \${prefs.sound ? 'checked' : ''} onchange="togglePref('sound', this.checked)" style="transform:scale(1.25);">
            </div>
            <div class="item-row">
              <div class="item-info">
                <strong>Vibration & Haptics</strong>
                <small>Haptic feedback on alerts and decisions</small>
              </div>
              <input type="checkbox" \${prefs.vibrate ? 'checked' : ''} onchange="togglePref('vibrate', this.checked)" style="transform:scale(1.25);">
            </div>
            <div class="item-row">
              <div class="item-info">
                <strong>Web Push Notifications</strong>
                <small>Permission: \${notifStatus}</small>
              </div>
              <button class="action-btn primary" onclick="requestWebNotifications()">\${notifStatus === 'granted' ? 'Enabled' : 'Enable'}</button>
            </div>
          </div>
        </div>

        <div class="card" style="display:flex;flex-direction:column;gap:10px;">
          <button class="btn btn-secondary" style="color:var(--danger);" onclick="clearCredential()">Unpair and Revoke Device</button>
        </div>
      \`;
    }

    function setWorkerFilter(f) { appState.workerFilter = f; renderActiveTab(); }
    // Rendering replaces the tab's markup, search box included, so the box is
    // handed focus and caret back; otherwise every keystroke after the first
    // lands nowhere.
    function setSearchQuery(q) {
      appState.searchQuery = q;
      renderActiveTab();
      const input = document.querySelector("#appContainer .search-box input");
      if (input) {
        input.focus();
        try { input.setSelectionRange(input.value.length, input.value.length); } catch {}
      }
    }
    function clearFeed() { localStorage.removeItem(FEED_STORAGE_KEY); renderActiveTab(); }

    function togglePref(key, val) {
      const prefs = getPreferences();
      prefs[key] = val;
      savePreferences(prefs);
      SoundFx.beep("info");
    }

    async function requestWebNotifications() {
      if (!("Notification" in window)) {
        alert("Web notifications are not supported in this browser.");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        SoundFx.beep("success");
        showToast("Web Notifications enabled!", "success");
      }
      renderActiveTab();
    }
    function toggleNotificationsPrompt() {
      requestWebNotifications();
    }

    // ---------------------------------------------------------------------------
    // Ask Mission AI — read-only answers from the desktop's model
    // ---------------------------------------------------------------------------
    const NL = String.fromCharCode(10);
    const TICK = String.fromCharCode(96);
    const ASK_SUGGESTIONS = ["What is failing right now?", "Is the dev server up?", "What needs my attention?"];

    function canAsk(cred) {
      return Boolean(cred && Array.isArray(cred.scopes) && cred.scopes.indexOf("assistant.ask") !== -1);
    }

    // Takes text that has already been escaped, so only these fixed tags are added.
    function inlineMarkup(escaped) {
      const code = escaped.split(TICK);
      let out = "";
      for (let i = 0; i < code.length; i += 1) {
        if (i % 2 === 1 && i < code.length - 1) out += "<code>" + code[i] + "</code>";
        else out += (i % 2 === 1 ? TICK : "") + code[i];
      }
      const bold = out.split("**");
      if (bold.length < 3) return out;
      return bold.map((part, i) => (i % 2 === 1 && i < bold.length - 1) ? "<strong>" + part + "</strong>" : (i % 2 === 1 ? "**" + part : part)).join("");
    }

    function formatAnswer(text) {
      const fence = TICK + TICK + TICK;
      const segments = String(text == null ? "" : text).split(fence);
      let html = "";
      segments.forEach((segment, index) => {
        if (index % 2 === 1 && index < segments.length - 1) {
          const lines = segment.split(NL);
          if (lines.length > 1 && lines[0].trim().length < 20 && lines[0].trim().indexOf(" ") === -1) lines.shift();
          html += '<pre class="ask-code">' + esc(lines.join(NL).trim()) + "</pre>";
          return;
        }
        let paragraph = [];
        let list = [];
        const flushParagraph = () => { if (paragraph.length) { html += "<p>" + paragraph.map(line => inlineMarkup(esc(line))).join("<br>") + "</p>"; paragraph = []; } };
        const flushList = () => { if (list.length) { html += "<ul>" + list.map(item => "<li>" + inlineMarkup(esc(item)) + "</li>").join("") + "</ul>"; list = []; } };
        segment.split(NL).forEach(raw => {
          const line = raw.trim();
          if (!line) { flushParagraph(); flushList(); return; }
          if (line.indexOf("- ") === 0 || line.indexOf("* ") === 0) { flushParagraph(); list.push(line.slice(2)); return; }
          flushList();
          paragraph.push(line.replace(/^#+ /, ""));
        });
        flushParagraph();
        flushList();
      });
      return html;
    }

    function renderAskThread(ask) {
      if (!ask.messages.length && !ask.busy) {
        return '<div class="ask-empty"><strong>Ask about this project</strong><p>Mission AI looks at the workers and what they printed on the desktop, then answers here. It can only look — anything that needs doing goes through Workers and your approval.</p><div class="ask-suggestions">'
          + ASK_SUGGESTIONS.map(question => '<button type="button" data-q="' + esc(question) + '" onclick="askSuggestion(this.dataset.q)">' + esc(question) + "</button>").join("")
          + "</div></div>";
      }
      return ask.messages.map(message => {
        if (message.role === "user") return '<div class="ask-msg ask-msg--user">' + esc(message.text) + "</div>";
        const meta = [message.model, (message.looked || []).join(" · ")].filter(Boolean).join(" · ");
        return '<div class="ask-msg ask-msg--ai">'
          + (message.error ? '<p class="ask-error">' + esc(message.error) + "</p>" : formatAnswer(message.text))
          + (meta ? '<small class="ask-meta">' + esc(meta) + "</small>" : "")
          + "</div>";
      }).join("") + (ask.busy ? '<div class="ask-msg ask-msg--ai ask-msg--busy"><span class="ask-dots" aria-hidden="true"><i></i><i></i><i></i></span>Looking at the project…</div>' : "");
    }

    function renderAskTab(container, cred) {
      if (!canAsk(cred)) {
        container.innerHTML = '<div class="card"><div class="card-title"><span>Ask Mission AI</span></div><p class="msg">This phone was paired without permission to ask Mission AI. On the desktop, turn on Ask Mission AI under Integrations, Mobile Companion, then pair this phone again.</p></div>';
        return;
      }
      let thread = document.getElementById("askThread");
      // Polling repaints the active tab; the composer is kept so a half-typed question survives it.
      if (!thread || typeof container.contains !== "function" || !container.contains(thread)) {
        container.innerHTML = '<section class="ask"><div class="ask-thread" id="askThread" aria-live="polite"></div><form class="ask-composer" onsubmit="submitAsk(event)"><textarea id="askInput" rows="1" maxlength="2000" placeholder="Ask about this project…" aria-label="Question for Mission AI" oninput="rememberAskDraft(this.value)"></textarea><button type="submit" class="action-btn primary" id="askSend">Ask</button></form></section>';
        thread = document.getElementById("askThread");
        const input = document.getElementById("askInput");
        if (input) input.value = appState.ask.draft || "";
      }
      thread.innerHTML = renderAskThread(appState.ask);
      const send = document.getElementById("askSend");
      if (send) send.disabled = appState.ask.busy;
    }

    function rememberAskDraft(value) { appState.ask.draft = String(value || ""); }

    async function submitAsk(event) {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      const cred = getStoredCredential();
      const ask = appState.ask;
      const input = document.getElementById("askInput");
      const text = String((input && input.value) || ask.draft || "").trim();
      if (!text || ask.busy || !canAsk(cred)) return;
      const history = ask.messages.filter(message => !message.error && message.text).slice(-8).map(message => ({ role: message.role, text: message.text }));
      ask.messages.push({ role: "user", text: text });
      ask.draft = "";
      if (input) input.value = "";
      ask.busy = true;
      renderActiveTab();
      try {
        const result = await sendEncryptedRequest(cred, { operation: "ask", text: text, history: history });
        ask.messages.push({ role: "assistant", text: String((result && result.text) || ""), looked: (result && Array.isArray(result.looked)) ? result.looked : [], model: result && result.model ? String(result.model.label || "") : "" });
      } catch (error) {
        ask.messages.push({ role: "assistant", text: "", error: (error && error.message) || "Mission AI could not answer." });
      } finally {
        ask.busy = false;
        if (ask.messages.length > 40) ask.messages.splice(0, ask.messages.length - 40);
        if (appState.tab === "ask") renderActiveTab();
      }
    }

    function askSuggestion(question) {
      appState.ask.draft = String(question || "");
      const input = document.getElementById("askInput");
      if (input) input.value = appState.ask.draft;
      submitAsk();
    }

    function renderActiveTab() {
      const container = document.getElementById("appContainer");
      const cred = getStoredCredential();
      if (!cred) {
        renderPairForm();
        return;
      }
      const askTab = document.getElementById("navTabAsk");
      const desktopAskTab = document.getElementById("desktopNavTabAsk");
      if (askTab) askTab.style.display = canAsk(cred) ? "" : "none";
      if (desktopAskTab) desktopAskTab.style.display = canAsk(cred) ? "" : "none";

      if (appState.tab === "ask") {
        renderAskTab(container, cred);
        return;
      }
      const d = appState.data;
      if (!d) {
        appState.lastHtml = "";
        container.innerHTML = \`
          <div class="card" style="display:flex;flex-direction:column;gap:12px;align-items:center;text-align:center;padding:24px;">
            <p class="msg \${appState.error ? 'error' : ''}">\${esc(appState.error || "Connecting to live OUTARCH…")}</p>
            \${appState.error ? '<button class="action-btn primary" onclick="localStorage.removeItem(STORAGE_KEY);appState.data=null;appState.error=\\'\\';render();" style="font-size:12px;padding:8px 16px;">Re-Enter Pairing Code</button>' : ''}
          </div>
        \`;
        return;
      }

      let content = "";
      if (appState.tab === "overview") content = renderOverviewTab(d);
      else if (appState.tab === "workers") content = renderWorkersTab(d);
      else if (appState.tab === "needs") content = renderNeedsTab(d);
      else if (appState.tab === "memory") content = renderMemoryTab(d);
      else if (appState.tab === "feed") content = renderFeedTab();
      else if (appState.tab === "settings") content = renderSettingsTab(cred);

      // A poll every few seconds used to rebuild the tab each time, which dropped
      // a tap that landed mid-rebuild and pulled focus out of the search box.
      if (appState.lastHtml !== content) {
        const active = document.activeElement;
        const searching = Boolean(active && active.closest && active.closest(".search-box"));
        appState.lastHtml = content;
        container.innerHTML = content;
        if (searching) {
          const input = document.querySelector("#appContainer .search-box input");
          if (input) {
            input.focus();
            try { input.setSelectionRange(input.value.length, input.value.length); } catch {}
          }
        }
      }
    }

    function updatePinSlots(val) {
      const digits = String(val || "").replace(/[^0-9]/g, "").slice(0, 6);
      for (let i = 0; i < 6; i++) {
        const slot = document.getElementById("slot" + i);
        if (!slot) continue;
        slot.className = "pin-slot";
        if (i < digits.length) {
          slot.innerText = digits[i];
          slot.classList.add("is-filled");
        } else if (i === digits.length) {
          slot.innerHTML = '<span class="pin-caret"></span>';
          slot.classList.add("is-focused");
        } else {
          slot.innerText = "";
        }
      }
      if (digits.length === 6) {
        setTimeout(() => handlePair(), 150);
      }
    }

    async function renderPairForm() {
      const bNav = document.getElementById("bottomNav");
      const dNav = document.getElementById("desktopNav");
      if (bNav) bNav.style.display = "none";
      if (dNav) dNav.style.display = "none";

      const hashParams = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
      const queryParams = new URLSearchParams(window.location.search);
      // The code arrives in a link, so only its digits are trusted.
      const defaultCode = String(hashParams.get("code") || queryParams.get("code") || "").replace(/[^0-9]/g, "").slice(0, 6);
      if ((window.location.hash || window.location.search) && window.history && window.history.replaceState) {
        window.history.replaceState(null, "", window.location.pathname);
      }
      const container = document.getElementById("appContainer");
      const statusBadge = document.getElementById("connectionStatus");
      if (statusBadge) {
        statusBadge.className = "status-badge is-waiting";
        statusBadge.innerHTML = "<i></i><span>Ready to Pair</span>";
      }

      container.innerHTML = \`
        <div class="card pair-form">
          <div class="pair-hero">
            <div class="pair-shield-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <path d="m9 12 2 2 4-4"/>
              </svg>
            </div>
            <h2>Pair Web Companion</h2>
            <p>Connect this browser to monitor workers, receive real-time alerts, and resolve decisions securely over LAN.</p>
          </div>

          <div class="notice-box">
            <i></i>
            <span>X25519 &amp; AES-256-GCM Encrypted · LAN Only</span>
          </div>

          <div class="input-group">
            <label style="display:flex;justify-content:space-between;align-items:center;">
              <span>6-Digit One-Time Code</span>
              <small style="color:var(--text-dim);font-size:11px;font-family:var(--font-mono);">Desktop &gt; Settings &gt; Mobile</small>
            </label>
            <div class="pin-input-wrap">
              <div class="pin-slots-row" id="pinSlotsRow" onclick="const inp = document.getElementById('pairCode'); if (inp) { inp.focus(); }">
                <div class="pin-slot is-focused" id="slot0"><span class="pin-caret"></span></div>
                <div class="pin-slot" id="slot1"></div>
                <div class="pin-slot" id="slot2"></div>
                <div class="pin-slot" id="slot3"></div>
                <div class="pin-slot" id="slot4"></div>
                <div class="pin-slot" id="slot5"></div>
                <input id="pairCode" class="invisible-otp-input" type="text" maxlength="6" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" placeholder="" value="\${esc(defaultCode)}" oninput="updatePinSlots(this.value)" autofocus>
              </div>
            </div>
          </div>

          <div class="device-card-wrap">
            <div class="device-card-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
            </div>
            <div class="device-card-meta">
              <label for="pairName">Device Label</label>
              <input id="pairName" type="text" value="Web Companion (\${navigator.userAgent.includes('Macintosh') ? 'macOS' : navigator.userAgent.includes('Windows') ? 'Windows' : navigator.userAgent.includes('iPhone') ? 'iPhone' : navigator.userAgent.includes('Android') ? 'Android' : 'Browser'})">
            </div>
          </div>

          <button id="pairBtn" class="btn-pair-primary" onclick="handlePair()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            Authorize &amp; Connect
          </button>

          <div class="handshake-timeline" id="handshakeTimeline">
            <div class="handshake-step active" id="hStep1">
              <div class="step-dot active"></div>
              <span>1. Generating ephemeral X25519 keypair…</span>
            </div>
            <div class="handshake-step" id="hStep2">
              <div class="step-dot"></div>
              <span>2. Verifying zero-knowledge HMAC proof…</span>
            </div>
            <div class="handshake-step" id="hStep3">
              <div class="step-dot"></div>
              <span>3. Establishing AES-256-GCM encrypted session…</span>
            </div>
          </div>

          <div id="pairMsg" class="msg"></div>
        </div>
      \`;

      if (defaultCode) {
        updatePinSlots(defaultCode);
      }

      if (defaultCode && defaultCode.length === 6) {
        const msg = document.getElementById("pairMsg");
        if (msg) {
          msg.className = "msg info";
          msg.innerText = "Pairing code detected from QR scan. Tap above to connect.";
        }
      }
    }

    async function handlePair() {
      const code = document.getElementById("pairCode")?.value.trim() || "";
      const name = document.getElementById("pairName")?.value.trim() || "Web Companion";
      const btn = document.getElementById("pairBtn");
      const msg = document.getElementById("pairMsg");
      const timeline = document.getElementById("handshakeTimeline");

      if (!code || code.length !== 6) {
        if (msg) {
          msg.className = "msg error";
          msg.innerText = "Please enter the 6-digit code shown on your computer.";
        }
        for (let i = 0; i < 6; i++) {
          const slot = document.getElementById("slot" + i);
          if (slot) slot.classList.add("is-error");
        }
        setTimeout(() => {
          for (let i = 0; i < 6; i++) {
            const slot = document.getElementById("slot" + i);
            if (slot) slot.classList.remove("is-error");
          }
        }, 800);
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="pin-caret"></span> Establishing secure link…';
      }
      if (timeline) {
        timeline.style.display = "flex";
      }
      if (msg) {
        msg.className = "msg info";
        msg.innerText = "Verifying cryptographic proof with desktop…";
      }

      try {
        const s1 = document.getElementById("hStep1");
        const s2 = document.getElementById("hStep2");
        const s3 = document.getElementById("hStep3");
        if (s1) {
          s1.className = "handshake-step done";
          const dot = s1.querySelector(".step-dot");
          if (dot) dot.className = "step-dot done";
        }
        if (s2) {
          s2.className = "handshake-step active";
          const dot = s2.querySelector(".step-dot");
          if (dot) dot.className = "step-dot active";
        }

        await pairWithDesktop(code, name);

        if (s2) {
          s2.className = "handshake-step done";
          const dot = s2.querySelector(".step-dot");
          if (dot) dot.className = "step-dot done";
        }
        if (s3) {
          s3.className = "handshake-step done";
          const dot = s3.querySelector(".step-dot");
          if (dot) dot.className = "step-dot done";
        }
        if (btn) {
          btn.style.background = "linear-gradient(135deg, #10b981 0%, #059669 100%)";
          btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Connected!';
        }

        setTimeout(() => {
          render();
        }, 300);
      } catch (err) {
        if (timeline) timeline.style.display = "none";
        if (msg) {
          msg.className = "msg error";
          msg.innerText = err.message;
        }
        for (let i = 0; i < 6; i++) {
          const slot = document.getElementById("slot" + i);
          if (slot) slot.classList.add("is-error");
        }
        if (btn) {
          btn.disabled = false;
          btn.style.background = "";
          btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Authorize &amp; Connect';
        }
      }
    }

    // ---------------------------------------------------------------------------
    // App Initialization & PWA Service Worker
    // ---------------------------------------------------------------------------
    function render() {
      appState.lastHtml = "";
      if (appState.pollTimer) {
        clearInterval(appState.pollTimer);
        appState.pollTimer = null;
      }
      if (appState.sse) {
        appState.sse.close();
        appState.sse = null;
      }
      const cred = getStoredCredential();
      const bNav = document.getElementById("bottomNav");
      const dNav = document.getElementById("desktopNav");

      if (!cred) {
        if (bNav) bNav.style.display = "none";
        if (dNav) dNav.style.display = "none";
        renderPairForm();
      } else {
        if (bNav) bNav.style.display = "flex";
        if (dNav) dNav.style.display = "flex";
        refreshDashboard();
        connectSSE();
        appState.pollTimer = setInterval(refreshDashboard, 4000);
      }
    }

    // Desktop Keyboard Navigation Shortcuts
    window.addEventListener("keydown", e => {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) {
        if (e.key === "Escape") {
          closeActionModal();
          e.target.blur();
        }
        return;
      }
      if (e.key === "Escape") {
        closeActionModal();
      } else if (e.key === "1") {
        switchTab("overview");
      } else if (e.key === "2") {
        switchTab("workers");
      } else if (e.key === "3") {
        switchTab("needs");
      } else if (e.key === "4") {
        switchTab("memory");
      } else if (e.key === "5") {
        switchTab("feed");
      } else if (e.key === "6") {
        const cred = getStoredCredential();
        if (canAsk(cred)) switchTab("ask");
        else switchTab("settings");
      } else if (e.key === "7") {
        switchTab("settings");
      }
    });

    // PWA Service Worker Registration
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        // The page lives at /mobile, which the script's default scope
        // (/mobile/) does not cover; the gateway allows the wider scope.
        navigator.serviceWorker.register("/mobile/sw.js", { scope: "/mobile" }).catch(() => {});
      });
    }

    // PWA Install Prompt
    let deferredPrompt = null;
    window.addEventListener("beforeinstallprompt", e => {
      e.preventDefault();
      deferredPrompt = e;
      const banner = document.getElementById("pwaBanner");
      if (banner) banner.classList.add("is-visible");
      const btn = document.getElementById("btnInstallPwa");
      if (btn) {
        btn.onclick = async () => {
          if (!deferredPrompt) return;
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          if (outcome === "accepted") banner.classList.remove("is-visible");
          deferredPrompt = null;
        };
      }
    });

    render();
  </script>
</body>
</html>`;
}

module.exports = { getMobileManifestJson, getMobileServiceWorkerJs, getMobileWebCompanionHtml };
