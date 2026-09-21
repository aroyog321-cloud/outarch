import React from "react";
import { BrandWordmark, PRODUCT_VERSION } from "./BrandMark.jsx";
import { useAccount } from "./useAccount.js";

// OUTARCH runs only for a signed-in account. Signing in happens on the OUTARCH
// website (email and password, or Google); this screen starts that round trip
// and waits for the website to hand the session back. It is the boot screen's
// sibling: the same wordmark on the same black canvas, so launch, sign-in and
// the app read as one continuous surface.

function ArrowOut() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>;
}

function ShieldNote() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3.5 19 6v5.5c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6Z"/><path d="m9 12 2 2 4-4"/></svg>;
}

// The native window controls sit over this screen's top edge; paint them in
// its colour until the app's own status tape takes over.
function usePlainWindowChrome() {
  React.useEffect(() => {
    try { window.missionControl?.setWindowChrome?.({ mode: "standard", color: "#000000" })?.catch?.(() => {}); } catch { /* presentation only */ }
  }, []);
}

function GateShell({ children, label }) {
  usePlainWindowChrome();
  return <main className="account-gate" aria-label={label}>
    <div className="account-gate__drag" aria-hidden="true"/>
    <div className="account-gate__column">
      <BrandWordmark large className="account-gate__wordmark"/>
      {children}
    </div>
    <footer className="account-gate__footer">
      <span><ShieldNote/>Your session is encrypted on this device. The app never sees your password.</span>
      {PRODUCT_VERSION ? <span>Version {PRODUCT_VERSION}</span> : null}
    </footer>
  </main>;
}

export function AccountChecking({ message = "Checking your account" }) {
  return <GateShell label="Checking your OUTARCH account">
    <div className="account-gate__checking" role="status">
      <span className="account-gate__progress" aria-hidden="true"><i/></span>
      <p>{message}</p>
    </div>
  </GateShell>;
}

export function AccountGate({ status, api }) {
  const [busy, setBusy] = React.useState(false);
  const [localError, setLocalError] = React.useState("");
  const waiting = status?.state === "signing-in";
  const error = localError || status?.error || "";

  const start = async mode => {
    if (!api) return;
    setBusy(true);
    setLocalError("");
    try { await api.signIn(mode); }
    catch (reason) { setLocalError(reason?.message || "The sign-in page could not be opened."); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    setLocalError("");
    try { await api?.cancelSignIn(); } catch { /* the screen returns to sign-in either way */ }
  };

  if (waiting) {
    return <GateShell label="Finish signing in to OUTARCH">
      <section className="account-gate__card" aria-live="polite">
        <span className="account-gate__progress" aria-hidden="true"><i/></span>
        <h1>Continue in your browser</h1>
        <p>The OUTARCH sign-in page is open in your browser. When you are done there, it sends you straight back here.</p>
        {error ? <p className="account-gate__error" role="alert">{error}</p> : null}
        <div className="account-gate__actions">
          <button type="button" className="account-gate__secondary" disabled={busy} onClick={() => void start(status?.signIn?.mode === "signup" ? "signup" : "signin")}>Open the page again<ArrowOut/></button>
          <button type="button" className="account-gate__ghost" onClick={() => void cancel()}>Cancel</button>
        </div>
      </section>
    </GateShell>;
  }

  return <GateShell label="Sign in to OUTARCH">
    <section className="account-gate__card">
      <h1>Sign in to OUTARCH</h1>
      <p>Your account holds your plan and keeps Mission AI in sync. You sign in on the OUTARCH website, with your email or with Google, and come straight back here.</p>
      {error ? <p className="account-gate__error" role="alert">{error}</p> : null}
      <div className="account-gate__actions account-gate__actions--stack">
        <button type="button" className="account-gate__primary" disabled={busy || !api} onClick={() => void start("signin")}>{busy ? "Opening your browser…" : "Sign in with your browser"}{busy ? null : <ArrowOut/>}</button>
        <button type="button" className="account-gate__secondary" disabled={busy || !api} onClick={() => void start("signup")}>Create an account</button>
      </div>
      <p className="account-gate__hint">New accounts start on the Free plan.</p>
    </section>
  </GateShell>;
}

// Everything under this renders only for a signed-in account whose workspace
// is open. Before that: the sign-in screen, or the boot line while the engine
// comes up.
export function AccountBoundary({ children }) {
  const { status, api } = useAccount();
  if (!status) return <AccountChecking/>;
  if (!status.authorized) {
    if (status.state === "checking") return <AccountChecking message="Signing you in"/>;
    return <AccountGate status={status} api={api}/>;
  }
  if (!status.engineReady) return <div className="boot-screen" role="status"><BrandWordmark large className="boot-wordmark"/><span className="boot-progress" aria-hidden="true"><i/></span><p>Bringing your workspace online</p></div>;
  return children;
}
