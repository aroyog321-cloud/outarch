import React from "react";

// The signed-in account, its plan, and the updater, as the renderer sees them.
//
// Both come from the preload's own channels (window.missionControl.account and
// .updates) because they work before a project is open. Neither ever carries a
// token. A renderer with no account bridge — the visual harness, a test — is
// treated as signed in with nothing locked; the main process is what enforces
// the plan, so this can only ever show more than it allows, never grant it.

const UNMANAGED = Object.freeze({
  state: "authorized",
  authorized: true,
  engineReady: true,
  unmanaged: true,
  user: null,
  plan: { id: "ultimate", name: "Ultimate", rank: 2 },
  limits: null,
  plans: [],
  usage: null
});

function bridge(name) {
  if (typeof window === "undefined") return null;
  const value = window.missionControl?.[name];
  return value && typeof value === "object" ? value : null;
}

export const AccountContext = React.createContext({ status: UNMANAGED, api: null });

export function AccountProvider({ children }) {
  const api = React.useMemo(() => bridge("account"), []);
  const [status, setStatus] = React.useState(api ? null : UNMANAGED);
  React.useEffect(() => {
    if (!api) return undefined;
    let alive = true;
    let heard = false;
    let unsubscribe = null;
    try {
      unsubscribe = api.onChange(next => {
        if (!alive || !next) return;
        heard = true;
        setStatus(next);
      });
    } catch { /* the status read below still answers */ }
    Promise.resolve(api.status())
      .then(next => { if (alive && next && !heard) setStatus(next); })
      .catch(error => { if (alive && !heard) setStatus({ state: "signed-out", authorized: false, error: error?.message || "OUTARCH could not read your account." }); });
    return () => {
      alive = false;
      try { unsubscribe?.(); } catch { /* already gone */ }
    };
  }, [api]);
  const value = React.useMemo(() => ({ status, api }), [status, api]);
  return React.createElement(AccountContext.Provider, { value }, children);
}

export function useAccount() {
  return React.useContext(AccountContext);
}

export function useUpdates() {
  const api = React.useMemo(() => bridge("updates"), []);
  const [status, setStatus] = React.useState(null);
  React.useEffect(() => {
    if (!api) return undefined;
    let alive = true;
    let unsubscribe = null;
    try { unsubscribe = api.onChange(next => { if (alive && next) setStatus(next); }); } catch { /* read below */ }
    Promise.resolve(api.status()).then(next => { if (alive && next) setStatus(current => current || next); }).catch(() => {});
    return () => {
      alive = false;
      try { unsubscribe?.(); } catch { /* already gone */ }
    };
  }, [api]);
  return { status, api };
}

// One app-wide signal that a request was outside the plan. The upgrade dialog
// listens for it, so no call site needs its own "upgrade" plumbing.
export const PLAN_REQUIRED_EVENT = "outarch:plan-required";

export function requestUpgrade(detail = {}) {
  if (typeof window === "undefined") return;
  try { window.dispatchEvent(new CustomEvent(PLAN_REQUIRED_EVENT, { detail })); } catch { /* no window */ }
}
