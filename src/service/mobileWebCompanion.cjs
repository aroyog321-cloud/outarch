"use strict";

function getMobileManifestJson() {
  const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#0284c7"/><stop offset="100%" stop-color="#2563eb"/></linearGradient><linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#38bdf8"/><stop offset="100%" stop-color="#818cf8"/></linearGradient></defs><rect width="512" height="512" rx="128" fill="#080a10"/><rect x="24" y="24" width="464" height="464" rx="108" fill="url(#g)" opacity="0.18"/><rect x="24" y="24" width="464" height="464" rx="108" fill="none" stroke="rgba(56,189,248,0.3)" stroke-width="8"/><path d="M128 384V140l128 140 128-140v244" fill="none" stroke="url(#glow)" stroke-width="36" stroke-linecap="round" stroke-linejoin="round"/><circle cx="256" cy="280" r="22" fill="#38bdf8"/><circle cx="256" cy="280" r="34" fill="none" stroke="#38bdf8" stroke-width="4" opacity="0.5"/></svg>`;
  const iconDataUrl = `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString("base64")}`;

  return JSON.stringify({
    name: "Mission Control · Mobile Companion",
    short_name: "MC Companion",
    description: "Encrypted mobile supervision and decision companion for Mission Control",
    start_url: "/mobile",
    scope: "/mobile",
    display: "standalone",
    orientation: "portrait",
    background_color: "#080a10",
    theme_color: "#080a10",
    categories: ["utilities", "developer-tools", "productivity"],
    icons: [
      {
        src: iconDataUrl,
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any maskable"
      },
      {
        src: iconDataUrl,
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any maskable"
      }
    ]
  }, null, 2);
}

function getMobileServiceWorkerJs() {
  return `"use strict";

const CACHE_NAME = "mc-companion-v2";
const ASSETS_TO_CACHE = [
  "/mobile",
  "/mobile/",
  "/mobile/manifest.json"
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
  let payload = { title: "Mission Control Alert", body: "New attention item or worker status update" };
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
  <meta name="theme-color" content="#080a10">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="MC Companion">
  <link rel="manifest" href="/mobile/manifest.json">
  <title>Mission Control · Mobile Companion</title>
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
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.25), rgba(99, 102, 241, 0.15));
      border: 1px solid rgba(56, 189, 248, 0.4);
      border-radius: var(--radius-sm);
      color: var(--primary);
      font-size: 13.5px;
      font-weight: 850;
      letter-spacing: -0.02em;
      box-shadow: 0 0 20px rgba(56, 189, 248, 0.25);
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
    .pair-hero { text-align: center; padding: 12px 0 16px; }
    .pair-hero h2 { font-size: 22px; font-weight: 850; color: #fff; margin-bottom: 6px; letter-spacing: -0.02em; }
    .pair-hero p { font-size: 13.5px; color: var(--text-muted); line-height: 1.45; }
    .pair-form { display: flex; flex-direction: column; gap: 16px; }
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
    .code-input {
      font-family: var(--font-mono) !important;
      font-size: 30px !important;
      font-weight: 800 !important;
      letter-spacing: 10px !important;
      text-align: center !important;
      color: var(--primary) !important;
      background: rgba(56, 189, 248, 0.05) !important;
      border-color: rgba(56, 189, 248, 0.35) !important;
    }

    .notice-box {
      padding: 12px 14px;
      border-radius: var(--radius-md);
      background: rgba(56, 189, 248, 0.06);
      border: 1px solid rgba(56, 189, 248, 0.2);
      font-size: 12px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .notice-box i {
      width: 8px; height: 8px; border-radius: 50%; background: var(--primary); box-shadow: 0 0 8px var(--primary); flex-shrink: 0;
    }

    .msg { font-size: 12.5px; text-align: center; color: var(--text-muted); padding: 4px 0; }
    .msg.error { color: var(--danger); }
    .msg.success { color: var(--ok); }
    .msg.info { color: var(--primary); }

    /* Bottom Nav */

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
  </style>
</head>
<body>
  <div class="toast-container" id="toastContainer"></div>

  <header>
    <div class="brand" onclick="switchTab('overview')">
      <div class="brand-mark">MC</div>
      <div class="brand-title">
        <strong id="headerTitle">Mission Control</strong>
        <small id="headerSubtitle">Companion</small>
      </div>
    </div>
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
          throw new Error("No active pairing session found on desktop. Click 'Invite Device' in Mission Control Settings.");
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
        if (res.status === 401) {
          localStorage.removeItem(STORAGE_KEY);
          render();
          throw new Error("Session expired or device was revoked by desktop.");
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Request failed");
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
        const data = await sendEncryptedRequest(cred, { operation: "snapshot", includeTerminalEvidence: true });
        
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
    }

    function updateBadges() {
      const d = appState.data;
      const attention = (d?.attention || []).filter(item => item && item.state !== "recovered" && item.state !== "resolved" && item.state !== "dismissed");
      const attentionCount = attention.length;
      const navBadgeNeeds = document.getElementById("navBadgeNeeds");
      const headerBadge = document.getElementById("headerBadge");
      if (navBadgeNeeds) {
        navBadgeNeeds.style.display = attentionCount > 0 ? "flex" : "none";
        navBadgeNeeds.innerText = String(attentionCount);
      }
      if (headerBadge) {
        headerBadge.style.display = attentionCount > 0 ? "block" : "none";
      }
    }

    function switchTab(tab) {
      appState.tab = tab;
      document.querySelectorAll(".nav-tab").forEach(el => {
        el.classList.toggle("is-active", el.getAttribute("data-tab") === tab);
      });
      renderActiveTab();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    // ---------------------------------------------------------------------------
    // Action Modals & Drawers
    // ---------------------------------------------------------------------------
    function openActionModal(title, formHtml) {
      document.getElementById("modalTitle").innerText = title;
      document.getElementById("modalBody").innerHTML = formHtml;
      document.getElementById("actionModal").classList.add("is-open");
    }
    function closeActionModal() {
      document.getElementById("actionModal").classList.remove("is-open");
    }

    const WORKER_ACTIONS = ["start", "restart", "stop", "acknowledge"];
    function promptWorkerAction(workerId, action, defaultName) {
      if (!WORKER_ACTIONS.includes(action)) return;
      const title = (action === "restart" ? "Restart " : action === "start" ? "Start " : action === "stop" ? "Stop " : "Acknowledge ") + (defaultName || workerId);
      const html = \`
        <div style="display:flex;flex-direction:column;gap:16px;">
          <p style="font-size:13px;color:var(--text-muted);">This action creates an approval request on the desktop Groundstation operator queue.</p>
          <div class="input-group">
            <label>Operator Reason / Note</label>
            <input id="actionReason" type="text" placeholder="e.g. Memory spike resolution or manual restart" value="Mobile supervisor requested \${action}">
          </div>
          <button class="btn \${action === 'stop' ? 'action-btn danger' : ''}" id="btnSubmitAction" data-id="\${esc(workerId)}" data-action="\${action}" onclick="submitWorkerAction(this.dataset.id, this.dataset.action)">
            Submit \${action.toUpperCase()} Request
          </button>
        </div>
      \`;
      openActionModal(title, html);
    }

    async function submitWorkerAction(workerId, action) {
      const reason = document.getElementById("actionReason")?.value || "";
      const btn = document.getElementById("btnSubmitAction");
      if (btn) {
        btn.disabled = true;
        btn.innerText = "Encrypting & Submitting…";
      }
      const cred = getStoredCredential();
      if (!cred) return;
      try {
        await sendEncryptedRequest(cred, {
          operation: "request-worker-action",
          workerId: workerId,
          action: action,
          reason: reason
        });
        closeActionModal();
        SoundFx.beep("success");
        showToast("Request submitted for desktop approval!", "success");
        appendFeedItem({ kind: "action", title: "Action Requested", detail: action + " on " + workerId });
        refreshDashboard();
      } catch (err) {
        alert("Action request failed: " + err.message);
        if (btn) {
          btn.disabled = false;
          btn.innerText = "Try Again";
        }
      }
    }

    function promptRecipeAction(recipeId, action, defaultName) {
      if (!["run", "recover", "cancel"].includes(action)) return;
      const title = (action === "run" ? "Run " : action === "cancel" ? "Cancel " : "Recover ") + (defaultName || recipeId);
      const html = \`
        <div style="display:flex;flex-direction:column;gap:16px;">
          <p style="font-size:13px;color:var(--text-muted);">Requesting DAG recipe execution will create an approval on desktop.</p>
          <button class="btn" id="btnSubmitRecipe" data-id="\${esc(recipeId)}" data-action="\${action}" onclick="submitRecipeAction(this.dataset.id, this.dataset.action)">
            Confirm \${action.toUpperCase()} Workflow
          </button>
        </div>
      \`;
      openActionModal(title, html);
    }

    async function submitRecipeAction(recipeId, action) {
      const btn = document.getElementById("btnSubmitRecipe");
      if (btn) {
        btn.disabled = true;
        btn.innerText = "Encrypting & Submitting…";
      }
      const cred = getStoredCredential();
      if (!cred) return;
      try {
        await sendEncryptedRequest(cred, {
          operation: "request-recipe-action",
          recipeId: recipeId,
          action: action
        });
        closeActionModal();
        SoundFx.beep("success");
        showToast("Recipe request submitted!", "success");
        appendFeedItem({ kind: "action", title: "Workflow Requested", detail: action + " on recipe " + recipeId });
        refreshDashboard();
      } catch (err) {
        alert("Recipe request failed: " + err.message);
        if (btn) {
          btn.disabled = false;
          btn.innerText = "Try Again";
        }
      }
    }

    // ---------------------------------------------------------------------------
    // View Rendering Functions
    // ---------------------------------------------------------------------------
    function renderOverviewTab(d) {
      const workers = d.workers || [];
      const running = workers.filter(w => w.status === "running" || w.isAlive).length;
      const attention = (d.attention || []).filter(item => item && item.state !== "recovered" && item.state !== "resolved" && item.state !== "dismissed");
      const recipes = d.recipes || [];
      const chapters = d.projectMemory?.chapters || [];

      const healthState = attention.length > 0 ? "needs-attention" : workers.some(w => w.health?.tone === "pressure") ? "degraded" : "healthy";

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
            <div class="telemetry-tile" onclick="switchTab('workers')">
              <b style="color:var(--primary)">\${recipes.length}</b>
              <small>Workflows</small>
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
          <div class="card-title"><span>Active Workers Spotlight</span><span class="badge" onclick="switchTab('workers')" style="cursor:pointer">VIEW ALL</span></div>
          <div class="item-list">
            \${workers.slice(0, 4).map(w => {
              const isAlive = w.status === 'running' || w.isAlive;
              const stateClass = w.status === 'failed' ? 'critical' : isAlive ? 'running' : 'idle';
              return \`
                <div class="item-row">
                  <div class="item-info">
                    <strong>\${esc(w.name || w.id)}</strong>
                    <small>\${esc(w.command ? (w.command + ' ' + (w.args || []).join(' ')) : 'Worker process')}</small>
                  </div>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span class="pill \${stateClass}"><i></i>\${esc(isAlive ? 'Running' : w.status || 'Idle')}</span>
                    <button class="action-btn" \${workerActionAttrs(w.id, isAlive ? 'restart' : 'start', w.name || w.id)}>\${isAlive ? 'Restart' : 'Start'}</button>
                  </div>
                </div>
              \`;
            }).join('')}
          </div>
        </div>

        <div class="card" style="display:flex;gap:10px;">
          <button class="btn btn-secondary" onclick="refreshDashboard(true)" style="flex:1;">Refresh Telemetry</button>
        </div>
      \`;
    }

    function renderWorkersTab(d) {
      const workers = d.workers || [];
      const filter = appState.workerFilter;
      const search = (appState.searchQuery || "").toLowerCase();

      const filtered = workers.filter(w => {
        const isAlive = w.status === 'running' || w.isAlive;
        if (filter === "running" && !isAlive) return false;
        if (filter === "attention" && w.status !== "failed" && !w.needsAttention && !w.attention?.required) return false;
        if (filter === "idle" && isAlive) return false;
        if (search && !(w.name || w.id).toLowerCase().includes(search) && !(w.command || "").toLowerCase().includes(search)) return false;
        return true;
      });

      return \`
        <div class="filter-bar">
          <div class="filter-chip \${filter === 'all' ? 'is-active' : ''}" onclick="setWorkerFilter('all')">All (\${workers.length})</div>
          <div class="filter-chip \${filter === 'running' ? 'is-active' : ''}" onclick="setWorkerFilter('running')">Running</div>
          <div class="filter-chip \${filter === 'attention' ? 'is-active' : ''}" onclick="setWorkerFilter('attention')">Attention</div>
          <div class="filter-chip \${filter === 'idle' ? 'is-active' : ''}" onclick="setWorkerFilter('idle')">Idle</div>
        </div>

        <div class="search-box">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" placeholder="Search workers by name or command…" value="\${esc(appState.searchQuery)}" oninput="setSearchQuery(this.value)">
        </div>

        <div class="card">
          <div class="card-title"><span>Supervised Workers (\${filtered.length})</span></div>
          <div class="item-list">
            \${filtered.length === 0 ? '<p class="msg">No matching workers found.</p>' : filtered.map(w => {
              const isAlive = w.status === 'running' || w.isAlive;
              const stateClass = w.status === 'failed' ? 'critical' : isAlive ? 'running' : 'idle';
              return \`
                <div class="item-row" style="flex-direction:column;align-items:stretch;gap:12px;">
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                    <div class="item-info">
                      <strong>\${esc(w.name || w.id)}</strong>
                      <small>\${esc(w.command ? (w.command + ' ' + (w.args || []).join(' ')) : 'Process')}</small>
                    </div>
                    <span class="pill \${stateClass}"><i></i>\${esc(isAlive ? 'Running' : w.status || 'Idle')}</span>
                  </div>
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid rgba(255,255,255,0.05);padding-top:10px;">
                    <span style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono);">\${esc(w.role || 'worker')}</span>
                    <div style="display:flex;gap:6px;">
                      \${isAlive ? \`
                        <button class="action-btn" \${workerActionAttrs(w.id, 'restart', w.name || w.id)}>Restart</button>
                        <button class="action-btn danger" \${workerActionAttrs(w.id, 'stop', w.name || w.id)}>Stop</button>
                      \` : \`
                        <button class="action-btn primary" \${workerActionAttrs(w.id, 'start', w.name || w.id)}>Start Worker</button>
                      \`}
                    </div>
                  </div>
                </div>
              \`;
            }).join('')}
          </div>
        </div>
      \`;
    }

    function renderNeedsTab(d) {
      const attention = (d.attention || []).filter(item => item && item.state !== "recovered" && item.state !== "resolved" && item.state !== "dismissed");
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
                return \`
                <div class="item-row" style="flex-direction:column;align-items:stretch;gap:12px;">
                  <div class="item-info">
                    <strong>\${esc(targetName)}</strong>
                    <p style="font-size:13px;color:var(--danger);margin-top:4px;font-weight:600;">\${esc(reasonText)}</p>
                    <small style="color:var(--text-dim);margin-top:4px;">Target ID: \${esc(targetId)}</small>
                  </div>
                  <div style="display:flex;gap:8px;">
                    <button class="action-btn primary" style="flex:1;" \${workerActionAttrs(targetId, 'restart', targetName)}>Request Restart</button>
                    <button class="action-btn" style="flex:1;" \${workerActionAttrs(targetId, 'acknowledge', targetName)}>Acknowledge</button>
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
                <small>\${canAsk(cred) ? 'Allowed — read-only answers from the desktop' : 'Not allowed for this phone. Turn it on on the desktop, then pair again.'}</small>
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
      if (askTab) askTab.style.display = canAsk(cred) ? "" : "none";
      if (appState.tab === "ask") {
        renderAskTab(container, cred);
        return;
      }
      const d = appState.data;
      if (!d) {
        container.innerHTML = \`<div class="card"><p class="msg">\${esc(appState.error || "Connecting to live Mission Control…")}</p></div>\`;
        return;
      }

      let content = "";
      if (appState.tab === "overview") content = renderOverviewTab(d);
      else if (appState.tab === "workers") content = renderWorkersTab(d);
      else if (appState.tab === "needs") content = renderNeedsTab(d);
      else if (appState.tab === "memory") content = renderMemoryTab(d);
      else if (appState.tab === "feed") content = renderFeedTab();
      else if (appState.tab === "settings") content = renderSettingsTab(cred);

      container.innerHTML = content;
    }

    async function renderPairForm() {
      document.getElementById("bottomNav").style.display = "none";
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
            <h2>Pair Mobile Companion</h2>
            <p>Connect your smartphone to monitor workers, receive real-time alerts, and resolve decisions securely over LAN.</p>
          </div>

          <div class="notice-box">
            <i/>
            <span>End-to-end encrypted with X25519 & AES-256-GCM. LAN only.</span>
          </div>

          <div class="input-group">
            <label>6-Digit One-Time Code</label>
            <input id="pairCode" class="code-input" type="text" maxlength="6" inputmode="numeric" placeholder="123456" value="\${esc(defaultCode)}" autofocus>
          </div>

          <div class="input-group">
            <label>Device Label</label>
            <input id="pairName" type="text" value="Smartphone (\${navigator.userAgent.includes('iPhone') ? 'iPhone' : navigator.userAgent.includes('Android') ? 'Android' : 'Mobile'})">
          </div>

          <button id="pairBtn" class="btn" onclick="handlePair()">Authorize & Connect</button>
          <div id="pairMsg" class="msg"></div>
        </div>
      \`;

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
      const name = document.getElementById("pairName")?.value.trim() || "Mobile Phone";
      const btn = document.getElementById("pairBtn");
      const msg = document.getElementById("pairMsg");
      if (!code || code.length !== 6) {
        if (msg) {
          msg.className = "msg error";
          msg.innerText = "Please enter the 6-digit code shown on your computer.";
        }
        return;
      }
      if (btn) {
        btn.disabled = true;
        btn.innerText = "Establishing secure link…";
      }
      if (msg) {
        msg.className = "msg info";
        msg.innerText = "Verifying cryptographic proof with desktop…";
      }
      try {
        await pairWithDesktop(code, name);
        render();
      } catch (err) {
        if (msg) {
          msg.className = "msg error";
          msg.innerText = err.message;
        }
        if (btn) {
          btn.disabled = false;
          btn.innerText = "Authorize & Connect";
        }
      }
    }

    // ---------------------------------------------------------------------------
    // App Initialization & PWA Service Worker
    // ---------------------------------------------------------------------------
    function render() {
      if (appState.pollTimer) {
        clearInterval(appState.pollTimer);
        appState.pollTimer = null;
      }
      if (appState.sse) {
        appState.sse.close();
        appState.sse = null;
      }
      const cred = getStoredCredential();
      if (!cred) {
        renderPairForm();
      } else {
        document.getElementById("bottomNav").style.display = "flex";
        refreshDashboard();
        connectSSE();
        appState.pollTimer = setInterval(refreshDashboard, 4000);
      }
    }

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
