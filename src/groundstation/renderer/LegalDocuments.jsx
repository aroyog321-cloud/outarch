import React from "react";
import { useAccount } from "./useAccount.js";
import { AGREEMENT_POLICY_IDS, LEGAL_UPDATED, LEGAL_VERSION, POLICIES, fillPolicyText, policyById } from "./legal/outarchPolicies.js";

// OUTARCH's policies inside the app, so they can be read after installing
// without opening the website: the reader, the record of what this user agreed
// to, and Settings > Legal & privacy. The text is shared with the website
// (legal/outarchPolicies.js); nothing here restates a policy in other words.

const FALLBACK_KEY = "outarch.legal-acceptance.v1";
const OPERATOR = "OUTARCH";
const JURISDICTION = "India";

function policyValues(supportEmail) {
  const email = typeof supportEmail === "string" ? supportEmail.trim() : "";
  return {
    operator: OPERATOR,
    jurisdiction: JURISDICTION,
    contact: email || "us through the contact page on the OUTARCH website"
  };
}

export function usePolicyValues() {
  const { status } = useAccount();
  return policyValues(status?.supportEmail);
}

function readFallback() {
  try {
    const value = JSON.parse(localStorage.getItem(FALLBACK_KEY) || "null");
    return value && typeof value.version === "string" && typeof value.acceptedAt === "string" ? value : null;
  } catch { return null; }
}

// The agreement record. The main process keeps it in OUTARCH's data folder;
// a renderer without that bridge (an old preload) keeps it in local storage
// so the agreement is still asked for once and remembered.
export function useLegalAcceptance() {
  const api = typeof window !== "undefined" ? window.missionControl?.legal : null;
  const [state, setState] = React.useState({ ready: false, acceptance: null, error: "" });

  React.useEffect(() => {
    let active = true;
    if (!api?.status) {
      setState({ ready: true, acceptance: readFallback(), error: "" });
      return undefined;
    }
    api.status()
      .then(result => { if (active) setState({ ready: true, acceptance: result?.acceptance || null, error: "" }); })
      .catch(() => { if (active) setState({ ready: true, acceptance: readFallback(), error: "" }); });
    return () => { active = false; };
  }, [api]);

  const accept = React.useCallback(async () => {
    const request = { version: LEGAL_VERSION, documents: [...AGREEMENT_POLICY_IDS] };
    let acceptance = null;
    if (api?.accept) {
      const result = await api.accept(request);
      acceptance = result?.acceptance || null;
    } else {
      acceptance = { ...request, acceptedAt: new Date().toISOString() };
    }
    try { localStorage.setItem(FALLBACK_KEY, JSON.stringify(acceptance)); } catch { /* the main process record is the one that counts */ }
    setState({ ready: true, acceptance, error: "" });
    return acceptance;
  }, [api]);

  const current = Boolean(state.acceptance && state.acceptance.version === LEGAL_VERSION);
  return { ...state, current, accept };
}

// One policy, as the reader shows it.
export function PolicyDocument({ policy, values, headingLevel = 2 }) {
  if (!policy) return null;
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const Section = headingLevel === 3 ? "h4" : "h3";
  return <article className="legal-doc" aria-label={policy.title}>
    <Heading className="legal-doc__title">{policy.title}</Heading>
    <p className="legal-doc__meta">Last updated {LEGAL_UPDATED}</p>
    <p className="legal-doc__summary">{fillPolicyText(policy.summary, values)}</p>
    {policy.sections.map(section => <section key={section.heading} className="legal-doc__section">
      <Section>{section.heading}</Section>
      {section.blocks.map((block, index) => Array.isArray(block)
        ? <ul key={index}>{block.map(item => <li key={item}>{fillPolicyText(item, values)}</li>)}</ul>
        : <p key={index}>{fillPolicyText(block, values)}</p>)}
    </section>)}
  </article>;
}

function formatWhen(iso) {
  const at = Date.parse(iso || "");
  if (Number.isNaN(at)) return "";
  return new Date(at).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ChevronRight() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>;
}

// Settings > Legal & privacy: every policy, readable offline, the record of
// what was agreed, and how to get at or delete your data.
export function LegalSettings() {
  const values = usePolicyValues();
  const { acceptance, current } = useLegalAcceptance();
  const [openId, setOpenId] = React.useState(null);
  const reader = React.useRef(null);
  const open = openId ? policyById(openId) : null;

  React.useEffect(() => {
    if (open) reader.current?.focus();
  }, [open]);

  if (open) {
    return <div className="settings-view"><div className="settings-grid"><section className="settings-panel settings-panel-wide pm-card legal-reader-panel">
      <button type="button" className="legal-back" onClick={() => setOpenId(null)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>All policies</button>
      <div className="legal-reader" ref={reader} tabIndex={-1}><PolicyDocument policy={open} values={values} headingLevel={3}/></div>
    </section></div></div>;
  }

  return <div className="settings-view"><div className="settings-grid">
    <section className="settings-panel settings-panel-wide pm-card">
      <div className="settings-panel__head"><Icon/><div><h3>Legal &amp; privacy</h3><p>OUTARCH&apos;s terms and policies, readable here without the website.</p></div></div>
      <ul className="legal-list">
        {POLICIES.map(policy => <li key={policy.id}><button type="button" className="legal-list__item" onClick={() => setOpenId(policy.id)}>
          <span><strong>{policy.title}</strong><small>{fillPolicyText(policy.summary, values)}</small></span>
          <ChevronRight/>
        </button></li>)}
      </ul>
    </section>
    <section className="settings-panel settings-panel-wide pm-card">
      <div className="settings-panel__head"><div><h3>Your agreement</h3><p>What this Windows user agreed to when OUTARCH first started.</p></div></div>
      <div className="settings-rows">
        <div><span>Documents</span><strong>Terms of service and End user licence agreement</strong></div>
        <div><span>Version agreed</span><strong>{acceptance?.version || "Not recorded"}{acceptance && !current ? " (an older version)" : ""}</strong></div>
        <div><span>Agreed on</span><strong>{formatWhen(acceptance?.acceptedAt) || "Not recorded"}</strong></div>
        <div><span>Current version</span><strong>{LEGAL_VERSION}</strong></div>
      </div>
    </section>
    <section className="settings-panel settings-panel-wide pm-card">
      <div className="settings-panel__head"><div><h3>Your data</h3><p>Where it is, and how to get a copy or delete it.</p></div></div>
      <div className="settings-rows">
        <div><span>On this computer</span><strong>%APPDATA%\OUTARCH and your project folders</strong></div>
        <div><span>Held by OUTARCH</span><strong>Email, name (Google sign-in), plan and usage counts</strong></div>
        <div><span>Analytics and crash reports</span><strong>None are collected</strong></div>
      </div>
      <p className="settings-note">To get a copy of your account data, correct it or delete your account, contact {values.contact}, writing from your account&apos;s email address. Deleting your account does not touch anything on this computer; <button type="button" className="settings-inline-link" onClick={() => setOpenId("retention")}>Data retention &amp; deletion</button> explains how to remove local data too. <button type="button" className="settings-inline-link" onClick={() => setOpenId("ai-data")}>AI &amp; developer data</button> says exactly what can leave this computer, and when.</p>
    </section>
  </div></div>;
}

function Icon() {
  return <svg className="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M7 3.5h7.5L19 8v12.5H7Z"/><path d="M14.5 3.5V8H19"/><path d="M10 12h6M10 15.5h6"/></svg>;
}
