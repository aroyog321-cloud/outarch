import React, { useState } from 'react';
import { Code, Crown, DeviceMobile, Key, Plugs } from '@phosphor-icons/react';
import { useDemo } from '../useDemo.js';

const SECTIONS = ['Account', 'Notifications', 'Intelligence', 'Mobile companion', 'Connections', 'Automation workflows', 'About'];

// The app's notification preferences: sound, desktop notifications, quiet
// hours and a minimum importance.
const NOTIFICATION_ROWS = [
  ['Sound', 'Ring when something needs you. Windows plays its own sound when OUTARCH is in the background.', true],
  ['Windows notifications', 'Show a desktop notification while OUTARCH is not the focused window.', true],
  ['Quiet hours', 'Hold sounds overnight. Notices still arrive in the list.', false],
  ['Only warnings and failures', 'Skip notices for things that went right, like a server coming up.', false],
];

export function SettingsView() {
  const { dispatch } = useDemo();
  const [section, setSection] = useState('Notifications');
  const [values, setValues] = useState(() => NOTIFICATION_ROWS.map(row => row[2]));
  return <div className="rx-scroll" data-lenis-prevent="">
    <div className="rx-head"><span className="rx-caps mono rx-head__label">Settings</span><h3>{section}</h3><p>Changes save as you make them.</p></div>
    <div className="st-body">
      <div className="st-menu">{SECTIONS.map(item => <button key={item} type="button" aria-pressed={section === item} onClick={() => setSection(item)}>{item}</button>)}</div>
      <section className="rx-card st-panel">
        {section === 'Notifications' ? <>
          <h4>Notifications</h4><p>How OUTARCH tells you something happened.</p>
          {NOTIFICATION_ROWS.map(([title, text], index) => <div key={title} className="st-row"><div><b>{title}</b><small>{text}</small></div><button type="button" className="rx-toggle" role="switch" aria-checked={values[index]} aria-label={title} onClick={() => setValues(list => list.map((value, at) => (at === index ? !value : value)))}/></div>)}
          <div style={{ marginTop: 16 }}><button type="button" className="rx-btn" onClick={() => dispatch({ type: 'TOAST', toast: { tone: 'warn', title: 'This is a test notification', detail: 'It looks and sounds like a real one' } })}>Send a test notification</button></div>
        </> : <>
          <h4>{section}</h4>
          <p>{{
            Account: 'Your plan, its limits and today\'s Mission AI usage. Sign-in happens in your browser.',
            Intelligence: 'Built-in Mission AI models, or your own key from 18 providers, sealed by Windows.',
            'Mobile companion': 'Pair a phone with a QR code and a 6-digit code. Pro and Ultimate.',
            Connections: 'VS Code bridge and the Secure MCP gateway, each with explicit scopes.',
            'Automation workflows': 'Worker events that propose an allow-listed action, approved once.',
            About: 'Signed automatic updates, verified before they install.',
          }[section]}</p>
        </>}
      </section>
    </div>
  </div>;
}

const INTEGRATIONS = [
  { icon: Code, name: 'VS Code bridge', status: 'Ultimate', tone: '#b3b0ff', text: 'Active file, diagnostics, Git state and task results from VS Code. It never reads or types into your terminals.' },
  { icon: Plugs, name: 'Secure MCP gateway', status: 'Localhost', tone: '#63a9ff', text: 'Lets MCP clients read Mission Context on 127.0.0.1 with a token and scopes. Changes wait in Needs You.' },
  { icon: DeviceMobile, name: 'Mobile companion', status: 'Pro', tone: '#63a9ff', text: 'Encrypted supervision from your phone over your own network. Start and restart from the phone; stopping still asks you.' },
  { icon: Key, name: 'Mission AI keys', status: 'Ready', tone: '#4ade80', text: 'Built-in models through the OUTARCH proxy, or your own key. Keys are sealed by Windows.' },
];

export function IntegrationsView() {
  const { dispatch } = useDemo();
  return <div className="rx-scroll" data-lenis-prevent="">
    <div className="rx-head"><span className="rx-caps mono rx-head__label">Integrations</span><h3>Connected tools</h3><p>Every connection has explicit permissions and an audit trail.</p></div>
    <div className="ig-grid">
      {INTEGRATIONS.map(({ icon: Icon, name, status, tone, text }) => <article key={name} className="rx-card ig-card">
        <div className="ig-card__top"><span><Icon size={20}/></span><b>{name}</b><em style={{ color: tone, background: 'rgba(255,255,255,.06)' }}>{status === 'Pro' || status === 'Ultimate' ? <Crown size={11} weight="fill" style={{ marginRight: 4, verticalAlign: -1 }}/> : null}{status}</em></div>
        <p>{text}</p>
        <button type="button" className="rx-btn rx-btn--sm" onClick={() => dispatch({ type: 'TOAST', toast: { tone: 'info', title: name, detail: 'Set up in Settings, Connections' } })}>Configure</button>
      </article>)}
    </div>
  </div>;
}
