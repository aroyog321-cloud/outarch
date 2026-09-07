import React from "react";
import { confirmedRequest, missionApi } from "./missionApi.js";
import { generateQRCodeMatrix } from "./qrGenerator.js";

const SCOPE_OPTIONS = [
  ["summary.read", "Project Summary", "Health and aggregate state"],
  ["workers.read", "Workers & Agents", "Lifecycle, evidence, resources, and missions"],
  ["needs.read", "Needs You", "Current human decisions and blocker resolution"],
  ["memory.read", "Project Memory", "Bounded chapters and recovery links"],
  ["terminal.read", "Terminal Evidence", "Bounded redacted lines; disabled by default"],
  ["actions.request", "Request Actions", "Creates a local approval; never executes remotely"]
];

function timeLabel(timestamp) {
  if (!timestamp) return "Never connected";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  return minutes < 1 ? "Active now" : minutes < 60 ? `Seen ${minutes}m ago` : `Seen ${Math.floor(minutes / 60)}h ago`;
}

function refreshAge(timestamp) {
  if (!timestamp) return "never";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "less than a minute ago";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

/**
 * Standards-compliant QR Code component producing crisp SVG.
 */
function MobileQRCode({ url, size = 180 }) {
  const qrData = React.useMemo(() => {
    if (!url) return null;
    return generateQRCodeMatrix(url);
  }, [url]);

  if (!qrData || !url) {
    return (
      <div className="mobile-qr-placeholder" style={{ width: size, height: size }}>
        <span>Generating QR code…</span>
      </div>
    );
  }

  const { size: dim, grid } = qrData;
  const padding = 2;
  const totalDim = dim + padding * 2;
  const cellSize = size / totalDim;

  return (
    <div className="mobile-qr-box" title={url}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="mobile-qr-svg"
        shapeRendering="crispEdges"
      >
        <rect width={size} height={size} fill="#ffffff" rx="8" />
        {grid.map((row, r) =>
          row.map((cell, c) =>
            cell ? (
              <rect
                key={`${r}-${c}`}
                x={(c + padding) * cellSize}
                y={(r + padding) * cellSize}
                width={cellSize + 0.05}
                height={cellSize + 0.05}
                fill="#0a0e17"
              />
            ) : null
          )
        )}
      </svg>
    </div>
  );
}

export function MobileCompanionSettings({ workspace, onConfirm }) {
  const [status, setStatus] = React.useState(null);
  const [devices, setDevices] = React.useState([]);
  const [invitation, setInvitation] = React.useState(null);
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [selectedEndpoint, setSelectedEndpoint] = React.useState("");
  const [copiedKey, setCopiedKey] = React.useState("");
  const [timeLeft, setTimeLeft] = React.useState(0);
  const [resourceState, setResourceState] = React.useState({
    loading: true,
    statusError: "",
    devicesError: "",
    statusUpdatedAt: null,
    devicesUpdatedAt: null
  });

  const refresh = React.useCallback(async () => {
    setResourceState(current => ({ ...current, loading: true }));
    const [statusResult, devicesResult] = await Promise.allSettled([
      missionApi().request("mobile.status"),
      missionApi().request("mobile.device.list")
    ]);
    const now = Date.now();
    if (statusResult.status === "fulfilled") {
      const nextStatus = statusResult.value;
      setStatus(nextStatus);
      if (nextStatus?.activeInvitation) setInvitation(nextStatus.activeInvitation);
    }
    if (devicesResult.status === "fulfilled") {
      setDevices(Array.isArray(devicesResult.value) ? devicesResult.value : []);
    }
    setResourceState(current => ({
      ...current,
      loading: false,
      statusError: statusResult.status === "rejected" ? (statusResult.reason?.message || String(statusResult.reason)) : "",
      devicesError: devicesResult.status === "rejected" ? (devicesResult.reason?.message || String(devicesResult.reason)) : "",
      statusUpdatedAt: statusResult.status === "fulfilled" ? now : current.statusUpdatedAt,
      devicesUpdatedAt: devicesResult.status === "fulfilled" ? now : current.devicesUpdatedAt
    }));
    return statusResult.status === "fulfilled" ? statusResult.value : null;
  }, []);

  const invite = React.useCallback(async () => {
    setBusy("invite");
    setMessage("");
    try {
      const value = await confirmedRequest("mobile.invite");
      setInvitation(value);
      setMessage("New pairing code generated. Valid for 5 minutes.");
    } catch (error) {
      setMessage(error.message || String(error));
    } finally {
      setBusy("");
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    void refresh();

    try {
      unsubscribe = missionApi().subscribe(notification => {
        if (active && notification?.type === "integration:event" && notification.integration === "mobile") {
          setStatus(notification.status);
          if (notification.status?.activeInvitation) {
            setInvitation(notification.status.activeInvitation);
          }
          setResourceState(current => ({ ...current, statusError: "", statusUpdatedAt: Date.now() }));
          void missionApi().request("mobile.device.list").then(value => {
            if (!active) return;
            setDevices(Array.isArray(value) ? value : []);
            setResourceState(current => ({ ...current, devicesError: "", devicesUpdatedAt: Date.now() }));
          }).catch(error => {
            if (active) setResourceState(current => ({ ...current, devicesError: error?.message || String(error) }));
          });
        }
      }, { type: "integration:event", integration: "mobile" });
    } catch {}

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [refresh, workspace?.path]);

  // Auto-generate invite on first enable or if running without invite
  React.useEffect(() => {
    if (status?.running && !invitation && !busy) {
      void invite();
    }
  }, [status?.running, invitation, busy, invite]);

  // Countdown timer for invitation expiration
  React.useEffect(() => {
    if (!invitation?.expiresAt) {
      setTimeLeft(0);
      return;
    }
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.floor((invitation.expiresAt - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining === 0 && status?.running) {
        // Auto refresh when expired
        void invite();
      }
    };
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [invitation?.expiresAt, status?.running, invite]);

  const configure = async configuration => {
    setBusy("configure");
    setMessage("");
    try {
      const next = await missionApi().request("mobile.configure", { configuration });
      setStatus(next);
      await refresh();
      if (next.running) {
        setMessage("Mobile supervision service is running on your local network.");
        await invite();
      } else {
        setMessage("Mobile supervision service is disabled.");
        setInvitation(null);
      }
    } catch (error) {
      setMessage(error.message || String(error));
    } finally {
      setBusy("");
    }
  };

  const toggleScope = scope => {
    const scopes = status?.scopes || [];
    const next = scopes.includes(scope) ? scopes.filter(item => item !== scope) : [...scopes, scope];
    void configure({ scopes: next });
  };

  const copyText = async (text, key) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(""), 2200);
    } catch {
      setMessage("Could not access clipboard. Please copy manually.");
    }
  };

  const revoke = async device => {
    setBusy(device.id);
    setMessage("");
    try {
      await confirmedRequest("mobile.device.revoke", { deviceId: device.id });
      await refresh();
      setMessage(`${device.name} was revoked immediately.`);
    } catch (error) {
      setMessage(error.message || String(error));
    } finally {
      setBusy("");
    }
  };

  const protectedStore = status?.available === true;
  const statusKnown = status !== null;
  const serviceLabel = !statusKnown && resourceState.loading
    ? "Loading status…"
    : !statusKnown && resourceState.statusError
      ? "Status unavailable"
      : status?.running
        ? "Service Active"
        : status?.enabled
          ? "Connecting…"
          : "Service Disabled";
  const knownCount = value => statusKnown ? String(value ?? 0) : "—";
  const webEndpoints = (status?.endpoints || []).map(ep => ep.replace(/\/$/, "") + "/mobile");
  const activeEndpoint = selectedEndpoint && webEndpoints.includes(selectedEndpoint)
    ? selectedEndpoint
    : webEndpoints[0] || null;

  // The pairing code is carried in the URL fragment (after #), which the browser
  // never sends to the server, writes to logs, or leaks via the Referer header.
  // The web companion reads it from location.hash and erases it on load.
  const pairingWebUrl = invitation && activeEndpoint
    ? `${activeEndpoint}#code=${invitation.code}`
    : activeEndpoint;

  const minutesRemaining = Math.floor(timeLeft / 60);
  const secondsRemaining = timeLeft % 60;
  const formattedTime = `${minutesRemaining}:${String(secondsRemaining).padStart(2, "0")}`;

  return (
    <section className={`settings-panel settings-panel-wide mobile-companion-settings ${status?.running ? "is-running" : ""}`}>
      {/* Top Header Card */}
      <header className="mobile-header-card">
        <div className="mobile-title">
          <span className="mobile-mark">MC</span>
          <div>
            <h3>Mobile Supervision Companion</h3>
            <p>Pair a smartphone for real-time monitoring and approval-gated operational control over LAN. It is not a remote shell or mobile IDE.</p>
          </div>
        </div>
        <div className="mobile-header-actions">
          <div className={`mobile-service-badge ${status?.running ? "is-live" : status?.enabled ? "is-warning" : resourceState.statusError ? "is-warning" : "is-offline"}`}>
            <i />
            <span>{serviceLabel}</span>
          </div>
          <button
            type="button"
            className={`btn-service-toggle ${status?.running ? "is-active" : ""}`}
            disabled={!statusKnown || !workspace?.persistent || !protectedStore || Boolean(busy)}
            onClick={() => void configure({ enabled: !status?.enabled })}
          >
            {busy === "configure" ? "Updating…" : status?.enabled ? "Disable Service" : "Enable Service"}
          </button>
        </div>
      </header>

      {resourceState.statusError && <div className="integration-resource-notice" role="status"><span><strong>Mobile service status could not be refreshed.</strong> {statusKnown ? `Showing status verified ${refreshAge(resourceState.statusUpdatedAt)}.` : "Controls remain unavailable until Mission Control can verify the service."}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}

      {/* LAN Security Banner */}
      <div className="mobile-lan-banner">
        <div className="mobile-lan-badge">LOCAL AREA NETWORK ONLY</div>
        <div className="mobile-lan-text">
          Zero cloud dependencies or remote exposure. End-to-end encrypted with X25519 key exchange, HKDF-SHA256, and AES-256-GCM.
        </div>
      </div>

      {/* Security Stat Summary */}
      <div className="mobile-stats-grid">
        <div className="mobile-stat-card">
          <span>TRANSPORT SECURITY</span>
          <strong>AES-256-GCM</strong>
          <small>Application-layer authenticated encryption</small>
        </div>
        <div className="mobile-stat-card">
          <span>PAIRED DEVICES</span>
          <strong>{knownCount(status?.deviceCount)} active · {knownCount(status?.revokedDeviceCount)} revoked</strong>
          <small>Protected via OS DPAPI/Keychain</small>
        </div>
        <div className={`mobile-stat-card ${status?.pendingApprovalCount ? "has-attention" : ""}`}>
          <span>PENDING REQUESTS</span>
          <strong>{knownCount(status?.pendingApprovalCount)} waiting</strong>
          <small>Approval-gated supervisor decisions</small>
        </div>
        <div className="mobile-stat-card">
          <span>ACTIVE SESSIONS</span>
          <strong>{knownCount(status?.activeClientCount)} connected</strong>
          <small>Real-time LAN telemetry streams</small>
        </div>
      </div>

      {/* Central Pairing Studio Hub */}
      {status?.running ? (
        <div className="mobile-pairing-hub">
          <div className="mobile-pairing-hub-header">
            <div className="pairing-hub-title">
              <span className="section-kicker">DEVICE PAIRING STUDIO</span>
              <h4>Connect Your Smartphone</h4>
            </div>
            {invitation && (
              <div className="pairing-timer-badge">
                <span className="timer-dot" />
                <span>Code expires in: <b>{formattedTime}</b></span>
                <button
                  type="button"
                  className="btn-refresh-code"
                  disabled={busy === "invite"}
                  onClick={() => void invite()}
                  title="Generate a fresh pairing code"
                >
                  {busy === "invite" ? "Generating…" : "Refresh Code"}
                </button>
              </div>
            )}
          </div>

          <div className="mobile-pairing-grid">
            {/* Left: Real Standards-Compliant QR Code */}
            <div className="mobile-qr-section">
              <div className="mobile-qr-frame">
                <MobileQRCode url={pairingWebUrl} size={180} />
                <div className="qr-scan-guide">
                  <strong>Scan with Phone Camera</strong>
                  <small>Opens Web Companion instantly with pre-filled code</small>
                </div>
              </div>

              {webEndpoints.length > 1 && (
                <div className="mobile-endpoint-selector">
                  <label htmlFor="endpoint-select">Network Interface:</label>
                  <select
                    id="endpoint-select"
                    value={activeEndpoint || ""}
                    onChange={e => setSelectedEndpoint(e.target.value)}
                  >
                    {webEndpoints.map(ep => (
                      <option key={ep} value={ep}>{ep}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Right: One-Time Code & Direct URL Access */}
            <div className="mobile-code-section">
              <div className="code-display-card">
                <div className="code-display-header">
                  <span>ONE-TIME PAIRING CODE</span>
                  <small>Kept in the link fragment; never sent to the server</small>
                </div>
                <div className="code-display-val">
                  {invitation ? (
                    <strong>{invitation.code}</strong>
                  ) : (
                    <button
                      type="button"
                      className="btn-create-code"
                      disabled={busy === "invite"}
                      onClick={() => void invite()}
                    >
                      {busy === "invite" ? "Generating…" : "Generate Pairing Code"}
                    </button>
                  )}
                </div>
                {invitation && (
                  <div className="code-actions">
                    <button
                      type="button"
                      className="btn-action"
                      onClick={() => void copyText(invitation.code, "code")}
                    >
                      {copiedKey === "code" ? "✓ Code Copied" : "Copy 6-Digit Code"}
                    </button>
                    <button
                      type="button"
                      className="btn-action"
                      onClick={() => void copyText(pairingWebUrl, "url")}
                    >
                      {copiedKey === "url" ? "✓ Link Copied" : "Copy Pairing Link"}
                    </button>
                  </div>
                )}
              </div>

              {/* Direct Web Companion Address */}
              <div className="mobile-direct-link-card">
                <div className="direct-link-header">
                  <span>DIRECT WEB COMPANION URL</span>
                </div>
                <div className="direct-link-row">
                  <code>{pairingWebUrl || "Waiting for local address…"}</code>
                  <button
                    type="button"
                    className="btn-copy-chip"
                    onClick={() => void copyText(pairingWebUrl, "direct")}
                  >
                    {copiedKey === "direct" ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>

              {/* Step-by-Step Instructions */}
              <div className="mobile-steps-list">
                <div className="step-item">
                  <span className="step-num">1</span>
                  <span>Point your phone camera at the QR code (or open the link above).</span>
                </div>
                <div className="step-item">
                  <span className="step-num">2</span>
                  <span>Confirm the 6-digit code matches the screen.</span>
                </div>
                <div className="step-item">
                  <span className="step-num">3</span>
                  <span>Tap Authorize on your phone to establish the encrypted link.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : statusKnown ? (
        <div className="mobile-disabled-card">
          <div className="disabled-icon">📱</div>
          <h4>Mobile Supervision is Currently Disabled</h4>
          <p>Enable the local companion service above to pair your smartphone or tablet for encrypted telemetry and supervision.</p>
          <button
            type="button"
            className="btn-enable-hero"
            disabled={!workspace?.persistent || !protectedStore || Boolean(busy)}
            onClick={() => void configure({ enabled: true })}
          >
            {busy === "configure" ? "Enabling…" : "Enable Mobile Companion"}
          </button>
        </div>
      ) : <div className="mobile-disabled-card" aria-busy={resourceState.loading ? "true" : undefined}><h4>{resourceState.loading ? "Checking Mobile Companion…" : "Mobile Companion unavailable"}</h4><p>{resourceState.loading ? "Mission Control is verifying local service and secure-storage availability." : "Retry the status request before enabling or configuring mobile supervision."}</p></div>}

      {/* Permissions Matrix */}
      <div className="mobile-permissions-section">
        <span className="section-kicker">DEVICE PERMISSIONS</span>
        <div className="mobile-permissions-grid">
          {SCOPE_OPTIONS.map(([id, label, detail]) => (
            <label key={id} className="permission-toggle-card">
              <div className="permission-info">
                <strong>{label}</strong>
                <p>{detail}</p>
              </div>
              <div className="pm-toggle">
                <input
                  type="checkbox"
                  checked={(status?.scopes || []).includes(id)}
                  disabled={!protectedStore || Boolean(busy)}
                  onChange={() => toggleScope(id)}
                />
                <div className="pm-toggle-track">
                  <div className="pm-toggle-thumb" />
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Paired Devices List */}
      {resourceState.devicesError && <div className="integration-resource-notice" role="status"><span><strong>Paired devices could not be refreshed.</strong> {resourceState.devicesUpdatedAt ? `Showing devices verified ${refreshAge(resourceState.devicesUpdatedAt)}.` : "No devices are shown because the device registry is unavailable."}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}
      {resourceState.devicesUpdatedAt && !resourceState.devicesError && devices.length === 0 && <p className="integration-resource-empty">No mobile devices paired.</p>}
      {devices.length > 0 && (
        <div className="mobile-devices-section">
          <header className="mobile-devices-header">
            <div>
              <span className="section-kicker">TRUSTED DEVICES</span>
              <h4>Paired Mobile Clients ({devices.length})</h4>
            </div>
            <small>Revocation invalidates device credentials immediately</small>
          </header>
          <div className="mobile-devices-list">
            {devices.map(device => (
              <article key={device.id} className={`device-card ${device.state === "revoked" ? "is-revoked" : ""}`}>
                <div className="device-avatar">
                  {device.name.includes("iPhone") || device.name.includes("iOS") ? "📱" : device.name.includes("Android") ? "🤖" : "💻"}
                </div>
                <div className="device-details">
                  <strong>{device.name}</strong>
                  <small>
                    {device.state === "revoked"
                      ? "Revoked"
                      : `${timeLabel(device.lastSeenAt)} · ${device.scopes?.length || 0} permissions`}
                  </small>
                </div>
                <span className={`device-status-badge ${device.state === "revoked" ? "is-revoked" : "is-active"}`}>
                  {device.state}
                </span>
                {device.state !== "revoked" && (
                  <button
                    type="button"
                    className="btn-revoke"
                    disabled={Boolean(busy) || !onConfirm}
                    onClick={() => onConfirm?.({ title: `Revoke ${device.name}?`, detail: "This device loses access to Mobile Companion immediately.", recovery: "Pair the device again with a new one-time code to restore access.", confirmLabel: "Revoke device", run: () => revoke(device) })}
                  >
                    {busy === device.id ? "Revoking…" : "Revoke"}
                  </button>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

      {/* Status / Error Toast Message */}
      {message && (
        <div className={`mobile-status-toast ${status?.lastError ? "is-error" : ""}`} role="status">
          {message}
        </div>
      )}
    </section>
  );
}

// Mobile paired-device approvals render only through the unified decision model
// now (`useDecisions` -> `DecisionList`). The old per-integration approval queue
// was unrendered dead code that reported a false `0` pending on load failure.
