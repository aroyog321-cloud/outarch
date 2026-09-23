import React from "react";
import { confirmedRequest, missionApi } from "./missionApi.js";
import { generateQRCodeMatrix } from "./qrGenerator.js";
import { copyText } from "./clipboard.js";

const SCOPE_OPTIONS = [
  ["summary.read", "Project Summary", "Health and aggregate state"],
  ["workers.read", "Workers & Agents", "Lifecycle, evidence, resources, and missions"],
  ["needs.read", "Needs You", "Current human decisions and blocker resolution"],
  ["memory.read", "Project Memory", "Bounded chapters and recovery links"],
  ["terminal.read", "Terminal Evidence", "Bounded redacted lines; disabled by default"],
  ["actions.request", "Control workers & recipes", "Start, restart and run recipes from the phone. Stop and cancel always wait for your approval here"],
  ["assistant.ask", "Ask Mission AI", "Read-only answers about this project; nothing runs from the phone"]
];

function timeLabel(timestamp) {
  if (!timestamp) return "Never connected";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  return minutes < 1 ? "Active now" : minutes < 60 ? `Seen ${minutes}m ago` : `Seen ${Math.floor(minutes / 60)}h ago`;
}

// What a phone did on its own, in the words the operator would use.
const PHONE_ACTION_WORDS = {
  worker: { start: "Started", restart: "Restarted", acknowledge: "Acknowledged", stop: "Stopped" },
  recipe: { run: "Ran recipe", recover: "Recovered recipe", cancel: "Cancelled recipe" }
};
function phoneActionLabel(item) {
  const verb = PHONE_ACTION_WORDS[item.type]?.[item.action] || item.action;
  return `${verb} ${item.targetName || ""}`.trim();
}

// Why the phone service is not listening, in words the operator can act on.
function startProblem(error, port) {
  const text = String(error || "");
  if (/EADDRINUSE|address already in use/i.test(text)) return `Another program is using port ${port || 37422}. Close it, or restart OUTARCH, then try again.`;
  if (/EACCES|permission denied/i.test(text)) return `Windows would not let OUTARCH listen on port ${port || 37422}. Try again, or restart OUTARCH.`;
  return text || "The phone service did not start.";
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
      // The service is the source of truth: a code a phone just used, or one
      // locked after wrong guesses, disappears here too.
      setInvitation(nextStatus?.activeInvitation || null);
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
          setInvitation(notification.status?.activeInvitation || null);
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

  // One code is made for the operator when the panel first finds the service
  // running without one. After that a code is made only on request: renewing
  // it on every expiry filled the audit trail every five minutes the panel sat
  // open, and a failing request retried itself in a loop.
  const autoInviteRef = React.useRef(false);
  React.useEffect(() => {
    if (status?.running && !invitation && !busy && !autoInviteRef.current) {
      autoInviteRef.current = true;
      void invite();
    }
  }, [status?.running, invitation, busy, invite]);

  // A phone that pairs uses the code up; say so instead of leaving an empty box.
  const pairedCountRef = React.useRef(null);
  React.useEffect(() => {
    const count = status?.deviceCount;
    if (typeof count !== "number") return;
    if (pairedCountRef.current !== null && count > pairedCountRef.current) setMessage("A phone just paired. It is listed under Paired phones.");
    pairedCountRef.current = count;
  }, [status?.deviceCount]);

  // Countdown timer for invitation expiration
  React.useEffect(() => {
    if (!invitation?.expiresAt) {
      setTimeLeft(0);
      return;
    }
    const updateCountdown = () => setTimeLeft(Math.max(0, Math.floor((invitation.expiresAt - Date.now()) / 1000)));
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [invitation?.expiresAt]);

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
      const text = error.message || String(error);
      setMessage(/EADDRINUSE|EACCES/.test(text) ? startProblem(text, status?.port) : text);
    } finally {
      setBusy("");
    }
  };

  const toggleScope = scope => {
    const scopes = status?.scopes || [];
    const next = scopes.includes(scope) ? scopes.filter(item => item !== scope) : [...scopes, scope];
    void configure({ scopes: next });
  };

  // A setting of its own: unlike a permission it changes nothing about who may
  // pair, so it does not create a new pairing code.
  const setAutoRun = async value => {
    setBusy("configure");
    setMessage("");
    try {
      const next = await missionApi().request("mobile.configure", { configuration: { autoRun: value } });
      setStatus(next);
      setMessage(value
        ? "A phone's requests to start, restart or run a recipe now go straight through."
        : "Every request from a phone now waits here for your approval.");
    } catch (error) {
      setMessage(error.message || String(error));
    } finally {
      setBusy("");
    }
  };

  // Named apart from the imported helper it calls: sharing the name made it call itself.
  const copyWithFeedback = async (text, key) => {
    if (!text) return;
    try {
      await copyText(text);
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
      setDevices(current => current.filter(item => item.id !== device.id));
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
  // Switched on but not listening has three reasons, and "Starting…" was shown
  // for all of them, forever, when the port was taken or the plan left it out.
  const planBlocked = Boolean(status?.enabled && !status?.running && status?.planAllowed === false);
  const startFailed = Boolean(status?.enabled && !status?.running && !planBlocked && status?.lastError);
  const serviceLabel = !statusKnown && resourceState.loading
    ? "Loading status…"
    : !statusKnown && resourceState.statusError
      ? "Status unavailable"
      : status?.running
        ? "Running"
        : planBlocked
          ? "Not in your plan"
          : startFailed
            ? "Could not start"
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

  const serviceTone = status?.running ? "is-live" : startFailed ? "is-error" : status?.enabled || resourceState.statusError ? "is-warning" : "is-offline";
  const codeExpired = Boolean(invitation && timeLeft === 0);
  const currentProject = workspace?.name || "";
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
  // Unset reads as on, the same as the service treats a setting saved before it existed.
  const autoRun = status?.autoRun !== false;
  const recentActions = status?.recentActions || [];

  return (
    <section className={`settings-panel settings-panel-wide mobile-companion-settings companion ${status?.running ? "is-running" : ""}`}>
      <header>
        <div className="settings-panel__head">
          <span className="companion__mark" aria-hidden="true"><PhoneGlyph/></span>
          <div>
            <h3>Mobile Companion</h3>
            <p>Follow this project from your phone on the same network, and start or restart a terminal or run a recipe from it — those go straight through. Stopping one, or cancelling a run, waits here for your approval. It is not a remote shell or mobile IDE.</p>
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

      {resourceState.statusError && <div className="integration-resource-notice" role="status"><span><strong>Mobile service status could not be refreshed.</strong> {statusKnown ? `Showing status verified ${refreshAge(resourceState.statusUpdatedAt)}.` : "Controls remain unavailable until OUTARCH can verify the service."}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}

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
              <p>{!invitation
                ? "Make a one-time code, then scan it with the phone's camera."
                : codeExpired
                  ? "This code has expired. Make a new one to pair a phone."
                  : <>Scan the code with the phone's camera, or open the link on it. The code works once and expires in <b className="companion__timer">{formattedTime}</b>.</>}</p>
            </div>
            {invitation && <button type="button" className={codeExpired ? "companion__primary" : "companion__ghost"} disabled={busy === "invite"} onClick={() => void invite()} title="Replace the code with a new one">
              {busy === "invite" ? "Creating…" : "New code"}
            </button>}
          </header>
          {invitation ? <div className="companion__pair-body">
            <div className={`companion__qr ${codeExpired ? "is-expired" : ""}`}>
              <MobileQRCode url={pairingWebUrl} size={164}/>
              {codeExpired && <span className="companion__qr-veil">Expired</span>}
            </div>
            <div className="companion__pair-detail">
              <div className="companion__code">
                <small>One-time code</small>
                <strong className={codeExpired ? "is-expired" : ""} aria-label={`Pairing code ${invitation.code.split("").join(" ")}${codeExpired ? ", expired" : ""}`}>{formattedCode}</strong>
                {!codeExpired && <button type="button" className="companion__ghost" onClick={() => void copyWithFeedback(invitation.code, "code")}>{copiedKey === "code" ? "Copied" : "Copy code"}</button>}
              </div>
              <div className="companion__link">
                <code title={pairingWebUrl || ""}>{pairingWebUrl || "Waiting for a local address…"}</code>
                <button type="button" className="companion__ghost" disabled={!pairingWebUrl || codeExpired} onClick={() => void copyWithFeedback(pairingWebUrl, "url")}>{copiedKey === "url" ? "Copied" : "Copy link"}</button>
              </div>
              {webEndpoints.length > 1 && <div className="companion__endpoint" role="radiogroup" aria-label="Network address">
                <span>Network</span>
                {webEndpoints.map(endpoint => <button key={endpoint} type="button" role="radio" aria-checked={endpoint === activeEndpoint} className={endpoint === activeEndpoint ? "is-current" : ""} onClick={() => setSelectedEndpoint(endpoint)}>{endpoint.replace(/^https?:\/\//, "").replace(/\/mobile$/, "")}</button>)}
              </div>}
              <ol className="companion__steps">
                <li>Open the link on the phone. It has to be on the same Wi-Fi as this computer.</li>
                <li>Check the code on the phone matches the one here.</li>
                <li>Tap Pair this phone. The phone keeps its own encrypted key, and the code cannot be used again.</li>
              </ol>
            </div>
          </div> : <div className="companion__pair-empty">
            <button type="button" className="companion__primary" disabled={busy === "invite"} onClick={() => void invite()}>{busy === "invite" ? "Creating…" : "Create pairing code"}</button>
            <span>A code works once and lasts 5 minutes.</span>
          </div>}
          <details className="companion__help">
            <summary>The phone can't open the link?</summary>
            <ul>
              <li>Put the phone on the same Wi-Fi as this computer. Guest networks and mobile data cannot reach it.</li>
              <li>Windows may block the connection. In Windows Security, open Firewall &amp; network protection, then Allow an app through firewall, and allow OUTARCH (or Electron) on Private networks. Mark your Wi-Fi as a Private network.</li>
              <li>{webEndpoints.length > 1 ? "This computer has more than one network address. Pick the one on your Wi-Fi under Network, then scan again." : "If this computer uses a VPN, pause it and scan again."}</li>
            </ul>
          </details>
        </section>
      ) : statusKnown ? (
        <div className={`companion__off ${startFailed ? "is-error" : ""}`}>
          <div>
            <strong>{planBlocked ? "Your plan does not include the phone service" : startFailed ? "The phone service could not start" : status?.enabled ? "The phone service is starting" : "The phone service is off"}</strong>
            <p>{planBlocked
              ? "Mobile Companion comes with Pro and Ultimate. It turns on by itself when your plan includes it."
              : startFailed
                ? startProblem(status?.lastError, status?.port)
                : blockedReason || "Turn it on to pair a phone. It listens on your local network only, and a phone sees nothing until you pair it."}</p>
          </div>
          {!status?.enabled && <button
            type="button"
            className="companion__primary"
            disabled={!workspace?.persistent || !protectedStore || Boolean(busy)}
            onClick={() => void configure({ enabled: true })}
          >
            {busy === "configure" ? "Turning on…" : "Turn on"}
          </button>}
          {startFailed && <button
            type="button"
            className="companion__primary"
            disabled={Boolean(busy)}
            onClick={() => void configure({ enabled: true })}
          >
            {busy === "configure" ? "Trying…" : "Try again"}
          </button>}
        </div>
      ) : <div className="companion__off" aria-busy={resourceState.loading ? "true" : undefined}><div><strong>{resourceState.loading ? "Checking Mobile Companion…" : "Mobile Companion unavailable"}</strong><p>{resourceState.loading ? "OUTARCH is verifying local service and secure-storage availability." : "Retry the status request before enabling or configuring mobile supervision."}</p></div></div>}

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

      <section className="companion__section" aria-label="What happens when a phone asks">
        <header>
          <h4>When a phone asks</h4>
          <p>{autoRun ? "Start, restart, acknowledge and recipe runs go straight through, and show below." : "Every request from a phone waits here, in Needs You, until you approve it."} Stop and cancel always wait here.</p>
        </header>
        <div className="companion__rows">
          <label className="companion__row">
            <span><strong>Run phone requests without asking</strong><small>Needs “Control workers &amp; recipes” above. Turn it off to approve every request yourself.</small></span>
            <span className="pm-toggle">
              <input
                type="checkbox"
                checked={autoRun}
                disabled={!statusKnown || Boolean(busy)}
                onChange={() => void setAutoRun(!autoRun)}
              />
              <i className="pm-toggle-track"><b className="pm-toggle-thumb"/></i>
            </span>
          </label>
        </div>
        {recentActions.length > 0 && <ul className="companion__devices" aria-label="Recent phone actions">
          {recentActions.map(item => (
            <li key={item.id}>
              <span className="companion__device-icon" aria-hidden="true"><PhoneGlyph/></span>
              <div>
                <strong>{phoneActionLabel(item)}</strong>
                <small>{`${item.deviceName || "A phone"} · ${refreshAge(item.at)}${item.error ? ` · ${item.error}` : ""}`}</small>
              </div>
              <small>{item.state === "approved" ? "Done" : item.state === "failed" ? "Failed" : "Running…"}</small>
            </li>
          ))}
        </ul>}
      </section>

      {resourceState.devicesError && <div className="integration-resource-notice" role="status"><span><strong>Paired devices could not be refreshed.</strong> {resourceState.devicesUpdatedAt ? `Showing devices verified ${refreshAge(resourceState.devicesUpdatedAt)}.` : "No devices are shown because the device registry is unavailable."}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}
      <section className="companion__section" aria-label="Paired phones">
        <header>
          <h4>Paired phones</h4>
          <p>A phone follows the project it was paired with. Revoking one ends its access at once and removes it from this list; a phone can also unpair itself from its More tab.</p>
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
                <strong>{device.name}{device.projectName && currentProject && device.projectName !== currentProject ? <span className="companion__device-tag">Other project</span> : null}</strong>
                <small>{`${timeLabel(device.lastSeenAt)} · ${device.projectName ? `paired with ${device.projectName}` : `${device.scopes?.length || 0} permissions`}`}{device.scopes?.includes("actions.request") ? " · can start and restart" : ""}{device.scopes?.includes("assistant.ask") ? " · can ask Mission AI" : ""}</small>
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
