"use strict";

function getMobileWebCompanionHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="theme-color" content="#080a0f">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Mission Control · Mobile Companion</title>
  <style>
    :root {
      --bg: #080a0f;
      --surface: rgba(18, 22, 30, 0.85);
      --surface-card: rgba(24, 29, 40, 0.75);
      --surface-subtle: rgba(255, 255, 255, 0.03);
      --border: rgba(255, 255, 255, 0.08);
      --border-focus: #4f9dff;
      --border-glow: rgba(79, 157, 255, 0.35);
      --text: #f0f4f8;
      --text-muted: #8b92a2;
      --text-dim: #5a6272;
      --accent: #4f9dff;
      --accent-glow: rgba(79, 157, 255, 0.25);
      --ok: #3ecf8e;
      --ok-soft: rgba(62, 207, 142, 0.12);
      --warn: #eea544;
      --warn-soft: rgba(238, 165, 68, 0.12);
      --danger: #ff5c67;
      --danger-soft: rgba(255, 92, 103, 0.12);
      --cyan: #5cd8e8;
      --cyan-soft: rgba(92, 216, 232, 0.12);
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, "JetBrains Mono", Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    body {
      background: var(--bg);
      background-image:
        radial-gradient(ellipse 80% 50% at 50% -20%, rgba(79, 157, 255, 0.15), transparent 70%),
        radial-gradient(ellipse 60% 40% at 100% 100%, rgba(92, 216, 232, 0.08), transparent 70%);
      color: var(--text);
      font-family: var(--font);
      font-size: 14px;
      line-height: 1.45;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding-bottom: env(safe-area-inset-bottom, 24px);
    }
    header {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: max(14px, env(safe-area-inset-top, 14px)) 18px 14px;
      background: rgba(8, 10, 15, 0.88);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-mark {
      width: 36px;
      height: 36px;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, rgba(79, 157, 255, 0.2), rgba(92, 216, 232, 0.1));
      border: 1px solid rgba(79, 157, 255, 0.3);
      border-radius: 10px;
      color: var(--cyan);
      font-size: 13px;
      font-weight: 800;
      box-shadow: 0 0 16px rgba(79, 157, 255, 0.2);
    }
    .brand-title strong { display: block; font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
    .brand-title small { display: block; font-size: 11px; color: var(--text-dim); }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 650;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
    }
    .status-badge i {
      width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor;
    }
    .status-badge.is-live { color: var(--ok); background: var(--ok-soft); border-color: rgba(62, 207, 142, 0.3); }
    .status-badge.is-offline { color: var(--text-dim); background: rgba(255, 255, 255, 0.03); }
    .status-badge.is-waiting { color: var(--warn); background: var(--warn-soft); border-color: rgba(238, 165, 68, 0.3); }

    main {
      flex: 1;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-width: 540px;
      width: 100%;
      margin: 0 auto;
    }
    .card {
      background: var(--surface);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 18px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35), inset 0 1px 0 0 rgba(255, 255, 255, 0.06);
    }
    .card-title {
      font-size: 11px;
      font-weight: 750;
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
      padding: 2px 8px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-muted);
      border: 1px solid var(--border);
    }

    /* Pairing Form */
    .pair-hero {
      text-align: center;
      padding: 10px 0 16px;
    }
    .pair-hero h2 {
      font-size: 18px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 6px;
    }
    .pair-hero p {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.4;
    }
    .pair-form { display: flex; flex-direction: column; gap: 16px; }
    .input-group { display: flex; flex-direction: column; gap: 8px; }
    .input-group label { font-size: 12px; font-weight: 650; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
    .input-group input {
      width: 100%;
      padding: 14px 16px;
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid var(--border);
      border-radius: 12px;
      color: #fff;
      font-size: 15px;
      font-family: inherit;
      outline: none;
      transition: all 180ms ease;
    }
    .input-group input:focus {
      border-color: var(--cyan);
      box-shadow: 0 0 16px rgba(92, 216, 232, 0.25);
    }
    .code-input {
      font-family: var(--font-mono) !important;
      font-size: 28px !important;
      font-weight: 800 !important;
      letter-spacing: 8px !important;
      text-align: center !important;
      color: var(--cyan) !important;
      background: rgba(92, 216, 232, 0.04) !important;
      border-color: rgba(92, 216, 232, 0.25) !important;
    }
    .code-input:focus {
      border-color: var(--cyan) !important;
      box-shadow: 0 0 20px rgba(92, 216, 232, 0.35) !important;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 14px 20px;
      background: linear-gradient(135deg, #0284c7, #2563eb);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      color: #fff;
      font-size: 14.5px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(37, 99, 235, 0.35);
      transition: all 150ms ease;
    }
    .btn:active { transform: scale(0.98); opacity: 0.9; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
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

    /* Telemetry grid */
    .telemetry-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }
    .telemetry-tile {
      background: var(--surface-subtle);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .telemetry-tile b { font-size: 22px; font-weight: 800; line-height: 1; }
    .telemetry-tile small { font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim); }

    /* Worker & Needs item */
    .item-list { display: flex; flex-direction: column; gap: 10px; }
    .item-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px;
      background: var(--surface-subtle);
      border: 1px solid var(--border);
      border-radius: 12px;
    }
    .item-info { min-width: 0; flex: 1; }
    .item-info strong { display: block; font-size: 13.5px; font-weight: 650; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .item-info small { display: block; font-size: 11px; color: var(--text-dim); font-family: var(--font-mono); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
    }
    .pill.running { color: var(--ok); background: var(--ok-soft); border: 1px solid rgba(62, 207, 142, 0.3); }
    .pill.idle { color: var(--text-muted); background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border); }
    .pill.critical { color: var(--danger); background: var(--danger-soft); border: 1px solid rgba(255, 92, 103, 0.3); }
    .pill.warning { color: var(--warn); background: var(--warn-soft); border: 1px solid rgba(238, 165, 68, 0.3); }

    .action-btn {
      padding: 7px 14px;
      font-size: 12px;
      font-weight: 650;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-muted);
      cursor: pointer;
      white-space: nowrap;
      transition: all 120ms ease;
    }
    .action-btn:active { background: rgba(255, 255, 255, 0.12); color: #fff; transform: scale(0.96); }
    .action-btn.danger { color: var(--danger); border-color: rgba(255, 92, 103, 0.3); background: var(--danger-soft); }

    .msg { font-size: 12.5px; text-align: center; color: var(--text-muted); padding: 4px 0; }
    .msg.error { color: var(--danger); }
    .msg.success { color: var(--ok); }
    .msg.info { color: var(--cyan); }

    .notice-box {
      padding: 12px 14px;
      border-radius: 10px;
      background: rgba(79, 157, 255, 0.06);
      border: 1px solid rgba(79, 157, 255, 0.2);
      font-size: 12px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .notice-box i {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--cyan);
      box-shadow: 0 0 8px var(--cyan);
      flex-shrink: 0;
    }

    .memory-chapter {
      padding: 12px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border);
      border-radius: 10px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .memory-chapter strong { font-size: 12.5px; color: var(--accent); }
    .memory-chapter p { font-size: 12px; color: var(--text-muted); line-height: 1.4; }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-mark">MC</div>
      <div class="brand-title">
        <strong id="headerTitle">Mission Control</strong>
        <small id="headerSubtitle">Mobile Supervision</small>
      </div>
    </div>
    <div id="connectionStatus" class="status-badge is-offline"><i></i><span>Offline</span></div>
  </header>

  <main id="appContainer">
    <div class="card"><p class="msg">Initializing secure session…</p></div>
  </main>

  <script>
    const API_VERSION = 1;
    const STORAGE_KEY = "mission_control_mobile_v1";

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
            temp = (SBOX[(temp >>> 24) & 0xff] << 24) | (SBOX[(temp >>> 16) & 0xff] << 16) | (SBOX[(temp >>> 8) & 0xff] << 8) | SBOX[rot & 0xff];
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

    function getStoredCredential() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); }
      catch { return null; }
    }

    function saveCredential(data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    function clearCredential() {
      if (confirm("Disconnect and unpair this mobile companion device?")) {
        localStorage.removeItem(STORAGE_KEY);
        render();
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

    let isPairing = false;

    async function pairWithDesktop(code, deviceName) {
      if (isPairing) return;
      isPairing = true;
      try {
        const endpoint = window.location.origin;
        const inviteRes = await fetch(endpoint + "/mobile/v1/invite");
        if (!inviteRes.ok) {
          throw new Error("No active pairing session found on desktop. Please make sure Mission Control is running.");
        }
        const invite = await inviteRes.json();

        // 1. Generate client X25519 keypair
        let clientPriv, clientPubSpki, clientPublicKey;
        clientPriv = PureCrypto.getRandomBytes(32);
        const basePoint = new Uint8Array(32); basePoint[0] = 9;
        const rawClientPub = PureCrypto.x25519ScalarMult(clientPriv, basePoint);
        clientPubSpki = PureCrypto.x25519ExportSpki(rawClientPub);
        clientPublicKey = bufToB64Url(clientPubSpki);

        // 2. Compute HMAC-SHA256 proof
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

    let state = { data: null, error: "", loading: false, pollTimer: null, sse: null };

    function connectSSE() {
      if (state.sse) {
        state.sse.close();
        state.sse = null;
      }
      try {
        const sse = new EventSource(window.location.origin + "/mobile/v1/events");
        sse.addEventListener("status", () => {
          refreshDashboard();
        });
        sse.addEventListener("open", () => {
          const statusBadge = document.getElementById("connectionStatus");
          if (statusBadge && state.data) {
            statusBadge.className = "status-badge is-live";
            statusBadge.innerHTML = "<i></i><span>Live</span>";
          }
        });
        sse.addEventListener("error", () => {
          // SSE connection dropped; adaptive polling will maintain sync
        });
        state.sse = sse;
      } catch (err) {
        // EventSource not supported
      }
    }

    async function refreshDashboard() {
      const cred = getStoredCredential();
      if (!cred) return;
      try {
        const data = await sendEncryptedRequest(cred, { operation: "snapshot", includeTerminalEvidence: false });
        state.data = data;
        state.error = "";
        const statusBadge = document.getElementById("connectionStatus");
        if (statusBadge) {
          statusBadge.className = "status-badge is-live";
          statusBadge.innerHTML = "<i></i><span>Live</span>";
        }
        if (data.project?.name) {
          const sub = document.getElementById("headerSubtitle");
          if (sub) sub.innerText = data.project.name;
        }
      } catch (err) {
        state.error = err.message;
        const statusBadge = document.getElementById("connectionStatus");
        if (statusBadge) {
          statusBadge.className = "status-badge is-offline";
          statusBadge.innerHTML = "<i></i><span>Offline</span>";
        }
      }
      renderDashboard();
    }

    async function requestWorkerAction(workerId, action, reason) {
      const cred = getStoredCredential();
      if (!cred) return;
      try {
        await sendEncryptedRequest(cred, {
          operation: "request-worker-action",
          workerId: workerId,
          action: action,
          reason: reason || ("Mobile operator requested " + action)
        });
        alert("Action request submitted! Approve it on your desktop Groundstation.");
        refreshDashboard();
      } catch (err) {
        alert("Action request failed: " + err.message);
      }
    }

    async function renderPairForm() {
      const hashParams = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
      const queryParams = new URLSearchParams(window.location.search);
      const defaultCode = hashParams.get("code") || queryParams.get("code") || "";
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
            <h2>Pair Mobile Supervision</h2>
            <p>Connect your smartphone to monitor workers and approve actions securely over LAN.</p>
          </div>

          <div class="notice-box">
            <i/>
            <span>End-to-end encrypted with X25519 & AES-256-GCM. LAN only.</span>
          </div>

          <div class="input-group">
            <label>6-Digit One-Time Code</label>
            <input id="pairCode" class="code-input" type="text" maxlength="6" inputmode="numeric" placeholder="123456" value="\${defaultCode}" autofocus>
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

    function renderDashboard() {
      const container = document.getElementById("appContainer");
      const d = state.data;
      if (!d) {
        container.innerHTML = \`<div class="card"><p class="msg">\${state.error || "Connecting to live telemetry…"}</p></div>\`;
        return;
      }
      const workers = d.workers || [];
      const running = workers.filter(w => w.status === "running" || w.isAlive).length;
      const attention = d.attention || [];
      const chapters = d.projectMemory?.chapters || [];

      let html = \`
        <div class="card">
          <div class="card-title"><span>Telemetry Overview</span><span class="badge">\${d.project?.name || 'Workspace'}</span></div>
          <div class="telemetry-grid">
            <div class="telemetry-tile"><b style="color:var(--ok)">\${running}/\${workers.length}</b><small>Running Workers</small></div>
            <div class="telemetry-tile"><b style="color:\${attention.length ? 'var(--warn)' : 'var(--text)'}">\${attention.length}</b><small>Needs You</small></div>
          </div>
        </div>
      \`;

      if (attention.length > 0) {
        html += \`
          <div class="card" style="border-color:rgba(238,165,68,0.35);background:rgba(238,165,68,0.06);">
            <div class="card-title" style="color:var(--warn)"><span>Needs Attention (\${attention.length})</span><span class="badge" style="background:rgba(238,165,68,0.2);color:var(--warn)">DECISION</span></div>
            <div class="item-list">
              \${attention.map(item => \`
                <div class="item-row">
                  <div class="item-info">
                    <strong>\${item.name || item.id}</strong>
                    <small style="color:var(--danger)">\${item.attentionReason || 'Worker requires supervisor attention'}</small>
                  </div>
                  <button class="action-btn" onclick="requestWorkerAction('\${item.id}', 'restart')">Request Restart</button>
                </div>
              \`).join('')}
            </div>
          </div>
        \`;
      }

      html += \`
        <div class="card">
          <div class="card-title"><span>Supervised Workers (\${workers.length})</span></div>
          <div class="item-list">
            \${workers.map(w => {
              const isAlive = w.status === 'running' || w.isAlive;
              const stateClass = w.status === 'failed' ? 'critical' : isAlive ? 'running' : 'idle';
              return \`
                <div class="item-row">
                  <div class="item-info">
                    <strong>\${w.name || w.id}</strong>
                    <small>\${w.command ? (w.command + ' ' + (w.args || []).join(' ')) : 'Worker process'}</small>
                  </div>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span class="pill \${stateClass}">\${isAlive ? 'Running' : w.status || 'Idle'}</span>
                    <button class="action-btn" onclick="requestWorkerAction('\${w.id}', '\${isAlive ? 'restart' : 'start'}')">\${isAlive ? 'Restart' : 'Start'}</button>
                  </div>
                </div>
              \`;
            }).join('')}
          </div>
        </div>
      \`;

      if (chapters.length > 0) {
        html += \`
          <div class="card">
            <div class="card-title"><span>Project Memory (\${chapters.length})</span></div>
            <div class="item-list">
              \${chapters.map(ch => \`
                <div class="memory-chapter">
                  <strong>\${ch.title || ch.id || 'Chapter'}</strong>
                  <p>\${ch.summary || ch.content || 'Active session notes'}</p>
                </div>
              \`).join('')}
            </div>
          </div>
        \`;
      }

      html += \`
        <div class="card" style="display:flex;flex-direction:column;gap:10px;">
          <button class="btn btn-secondary" onclick="refreshDashboard()">Refresh Telemetry</button>
          <button class="btn btn-secondary" style="color:var(--danger)" onclick="clearCredential()">Unpair Device</button>
        </div>
      \`;
      container.innerHTML = html;
    }

    function render() {
      if (state.pollTimer) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
      }
      if (state.sse) {
        state.sse.close();
        state.sse = null;
      }
      const cred = getStoredCredential();
      if (!cred) {
        renderPairForm();
      } else {
        refreshDashboard();
        connectSSE();
        state.pollTimer = setInterval(refreshDashboard, 4000);
      }
    }

    render();
  </script>
</body>
</html>`;
}

module.exports = { getMobileWebCompanionHtml };
