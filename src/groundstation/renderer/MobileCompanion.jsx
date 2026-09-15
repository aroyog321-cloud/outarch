import React from "react";
import { confirmedRequest, missionApi } from "./missionApi.js";
import { generateQRCodeMatrix } from "./qrGenerator.js";

const SCOPE_OPTIONS = [
  ["summary.read", "Project Summary", "Health and aggregate state"],
  ["workers.read", "Workers & Agents", "Lifecycle, evidence, resources, and missions"],
  ["needs.read", "Needs You", "Current human decisions and blocker resolution"],
  ["memory.read", "Project Memory", "Bounded chapters and recovery links"],
  ["terminal.read", "Terminal Evidence", "Bounded redacted lines; disabled by default"],
  ["actions.request", "Request Actions", "Creates a local approval; never executes remotely"],
  ["assistant.ask", "Ask Mission AI", "Read-only answers about this project; nothing runs from the phone"]
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
  const autoInviteAttemptedRef = React.useRef(null);
  React.useEffect(() => {
    if (!invitation?.expiresAt) {
      setTimeLeft(0);
      return;
    }
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.floor((invitation.expiresAt - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining === 0 && status?.running && !busy && autoInviteAttemptedRef.current !== invitation.expiresAt) {
        autoInviteAttemptedRef.current = invitation.expiresAt;
        void invite();
      }
    };
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [invitation?.expiresAt, status?.running, busy, invite]);

  const copyTimerRef = React.useRef(null);
  React.useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

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
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedKey(""), 2200);
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
      setMessage(`${device.name} was revoked and removed. The revocation is in the audit trail.`);
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
        ? "Running"
        : status?.enabled
          ? "Starting…"
          : "Off";
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

  const serviceTone = status?.running ? "is-live" : status?.enabled || resourceState.statusError ? "is-warning" : "is-offline";
  // Why the switch cannot be used, said beside it instead of left to a greyed button.
  const blockedReason = !statusKnown
    ? ""
    : !workspace?.persistent
      ? "Open a saved project first — a phone pairs with one project."
      : !protectedStore
        ? "This computer cannot encrypt device credentials, so pairing stays off."
        : "";
  const formattedCode = invitation?.code ? `${invitation.code.slice(0, 3)} ${invitation.code.slice(3)}` : "";
  const grantedCount = (status?.scopes || []).length;

  return (
    <section className={`settings-panel settings-panel-wide mobile-companion-settings companion ${status?.running ? "is-running" : ""}`}>
      <header>
        <div className="settings-panel__head">
          <span className="companion__mark" aria-hidden="true"><PhoneGlyph/></span>
          <div>
            <h3>Mobile Companion</h3>
            <p>Follow this project from your phone on the same network, and ask for a worker to start, stop or restart — every request waits here for your approval. It is not a remote shell or mobile IDE.</p>
          </div>
        </div>
        <div className={`companion__state ${serviceTone}`}>
          <i aria-hidden="true"/>
          <span><small>Phone service</small><strong>{serviceLabel}</strong></span>
          {status?.enabled && <button
            type="button"
            className="companion__switch"
            disabled={!statusKnown || Boolean(busy)}
            onClick={() => void configure({ enabled: false })}
          >
            {busy === "configure" ? "Updating…" : "Turn off"}
          </button>}
        </div>
      </header>

      {resourceState.statusError && <div className="integration-resource-notice" role="status"><span><strong>Mobile service status could not be refreshed.</strong> {statusKnown ? `Showing status verified ${refreshAge(resourceState.statusUpdatedAt)}.` : "Controls remain unavailable until Mission Control can verify the service."}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}

      <dl className="companion__facts">
        <div><dt>Paired phones</dt><dd>{knownCount(status?.deviceCount)}</dd><small>{status?.revokedDeviceCount ? `${status.revokedDeviceCount} revoked, kept in the audit trail` : "Credentials held by the OS keychain"}</small></div>
        <div><dt>Connected now</dt><dd>{knownCount(status?.activeClientCount)}</dd><small>Live updates over your network</small></div>
        <div className={status?.pendingApprovalCount ? "has-attention" : ""}><dt>Waiting for you</dt><dd>{knownCount(status?.pendingApprovalCount)}</dd><small>Phone requests in Needs You</small></div>
        <div><dt>Encryption</dt><dd>AES-256-GCM</dd><small>X25519 pairing · no cloud relay</small></div>
      </dl>

      {status?.running ? (
        <section className="companion__pair" aria-label="Pair a phone">
          <header>
            <div>
              <h4>Pair a phone</h4>
              <p>{invitation ? <>Scan the code with the phone's camera, or open the link on it. The code works once and expires in <b className="companion__timer">{formattedTime}</b>.</> : "Create a one-time code to pair a phone."}</p>
            </div>
            {invitation && <button type="button" className="companion__ghost" disabled={busy === "invite"} onClick={() => void invite()} title="Replace the code with a new one">
              {busy === "invite" ? "Creating…" : "New code"}
            </button>}
          </header>
          <div className="companion__pair-body">
            <div className="companion__qr"><MobileQRCode url={pairingWebUrl} size={164}/></div>
            <div className="companion__pair-detail">
              <div className="companion__code">
                <small>One-time code</small>
                {invitation
                  ? <strong aria-label={`Pairing code ${invitation.code.split("").join(" ")}`}>{formattedCode}</strong>
                  : <button type="button" className="companion__primary" disabled={busy === "invite"} onClick={() => void invite()}>{busy === "invite" ? "Creating…" : "Create pairing code"}</button>}
                {invitation && <button type="button" className="companion__ghost" onClick={() => void copyText(invitation.code, "code")}>{copiedKey === "code" ? "Copied" : "Copy code"}</button>}
              </div>
              <div className="companion__link">
                <code title={pairingWebUrl || ""}>{pairingWebUrl || "Waiting for a local address…"}</code>
                <button type="button" className="companion__ghost" disabled={!pairingWebUrl} onClick={() => void copyText(pairingWebUrl, "url")}>{copiedKey === "url" ? "Copied" : "Copy link"}</button>
              </div>
              {webEndpoints.length > 1 && <label className="companion__endpoint">
                <span>Network</span>
                <select value={activeEndpoint || ""} onChange={event => setSelectedEndpoint(event.target.value)}>
                  {webEndpoints.map(endpoint => <option key={endpoint} value={endpoint}>{endpoint}</option>)}
                </select>
              </label>}
              <ol className="companion__steps">
                <li>Open the link on the phone — it has to be on the same network as this computer.</li>
                <li>Check the code on the phone matches the one here.</li>
                <li>Tap Authorize &amp; Connect. The phone keeps an encrypted credential; the code is not reusable.</li>
              </ol>
            </div>
          </div>
        </section>
      ) : statusKnown ? (
        <div className="companion__off">
          <div>
            <strong>{status?.enabled ? "The phone service is starting" : "The phone service is off"}</strong>
            <p>{blockedReason || "Turn it on to pair a phone. It listens on your local network only, and a phone sees nothing until you pair it."}</p>
          </div>
          {!status?.enabled && <button
            type="button"
            className="companion__primary"
            disabled={!workspace?.persistent || !protectedStore || Boolean(busy)}
            onClick={() => void configure({ enabled: true })}
          >
            {busy === "configure" ? "Turning on…" : "Turn on"}
          </button>}
        </div>
      ) : <div className="companion__off" aria-busy={resourceState.loading ? "true" : undefined}><div><strong>{resourceState.loading ? "Checking Mobile Companion…" : "Mobile Companion unavailable"}</strong><p>{resourceState.loading ? "Mission Control is verifying local service and secure-storage availability." : "Retry the status request before enabling or configuring mobile supervision."}</p></div></div>}

      <section className="companion__section" aria-label="What paired phones can do">
        <header>
          <h4>What paired phones can do</h4>
          <p>{grantedCount} of {SCOPE_OPTIONS.length} allowed. Turning one off applies to every phone at once; turning one on applies to phones paired after that.</p>
        </header>
        <div className="companion__rows">
          {SCOPE_OPTIONS.map(([id, label, detail]) => (
            <label key={id} className="companion__row">
              <span><strong>{label}</strong><small>{detail}</small></span>
              <span className="pm-toggle">
                <input
                  type="checkbox"
                  checked={(status?.scopes || []).includes(id)}
                  disabled={!protectedStore || Boolean(busy)}
                  onChange={() => toggleScope(id)}
                />
                <i className="pm-toggle-track"><b className="pm-toggle-thumb"/></i>
              </span>
            </label>
          ))}
        </div>
      </section>

      {resourceState.devicesError && <div className="integration-resource-notice" role="status"><span><strong>Paired devices could not be refreshed.</strong> {resourceState.devicesUpdatedAt ? `Showing devices verified ${refreshAge(resourceState.devicesUpdatedAt)}.` : "No devices are shown because the device registry is unavailable."}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}
      <section className="companion__section" aria-label="Paired phones">
        <header>
          <h4>Paired phones</h4>
          <p>Revoking a phone ends its access at once and removes it from this list.</p>
        </header>
        {resourceState.devicesUpdatedAt && !resourceState.devicesError && devices.length === 0 && <p className="integration-resource-empty">No mobile devices paired.</p>}
        {/* A revoked device is removed from the register rather than kept in it
            wearing a badge that says it is gone. The revocation itself stays in
            the audit trail, where a security event can be read back with a time. */}
        {devices.length > 0 && <ul className="companion__devices">
          {devices.map(device => (
            <li key={device.id}>
              <span className="companion__device-icon" aria-hidden="true"><PhoneGlyph/></span>
              <div>
                <strong>{device.name}</strong>
                <small>{`${timeLabel(device.lastSeenAt)} · ${device.scopes?.length || 0} permissions`}{device.scopes?.includes("assistant.ask") ? " · can ask Mission AI" : ""}</small>
              </div>
              <button
                type="button"
                className="companion__revoke"
                disabled={Boolean(busy) || !onConfirm}
                onClick={() => onConfirm?.({ title: `Revoke ${device.name}?`, detail: "This device loses access to Mobile Companion immediately and is removed from this list.", recovery: "Pair the device again with a new one-time code to restore access. The revocation stays in the audit trail.", confirmLabel: "Revoke device", run: () => revoke(device) })}
              >
                {busy === device.id ? "Revoking…" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>}
      </section>

      {message && <p className={`companion__message ${status?.lastError ? "is-error" : ""}`} role="status">{message}</p>}
    </section>
  );
}

function PhoneGlyph() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="3" width="10" height="18" rx="2.4"/><path d="M11 17.5h2"/></svg>;
}

// Mobile paired-device approvals render only through the unified decision model
// now (`useDecisions` -> `DecisionList`). The old per-integration approval queue
// was unrendered dead code that reported a false `0` pending on load failure.
