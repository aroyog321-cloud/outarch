import React from 'react';
import { Link } from '../lib/router.jsx';
import { Lockup } from './Brand.jsx';

const COLUMNS = [
  ['Product', [['Live demo', '/#demo'], ['Features', '/#features'], ['How it works', '/#how'], ['Mobile companion', '/#mobile'], ['Download', '/#download']]],
  ['Plans', [['Pricing', '/pricing'], ['Compare plans', '/pricing#compare'], ['Your account', '/account'], ['Sign in', '/auth'], ['Create account', '/auth?mode=signup']]],
  ['Policies', [['Terms of service', '/terms'], ['Privacy policy', '/privacy'], ['Refunds and cancellation', '/refunds'], ['Delivery', '/delivery'], ['Contact', '/contact']]],
];

export default function Footer() {
  return <footer className="relative z-[1] mt-10 border-t border-line">
    <div className="mx-auto grid grid-cols-1 max-w-page gap-12 px-5 py-16 md:grid-cols-[1.3fr_2fr] md:px-8">
      <div className="max-w-sm">
        <Link to="/" aria-label="OUTARCH home"><Lockup/></Link>
        <p className="mt-5 text-[14.5px] leading-relaxed text-fg-muted">A local command center for developers on Windows: every terminal, dev server and AI coding agent in one window, with you in charge of what runs.</p>
      </div>
      <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
        {COLUMNS.map(([title, links]) => <div key={title}>
          <h3 className="text-[13px] font-medium text-fg">{title}</h3>
          <ul className="mt-4 space-y-2.5">
            {links.map(([label, to]) => <li key={to}><Link to={to} className="link-underline text-[14px] text-fg-muted hover:text-fg">{label}</Link></li>)}
          </ul>
        </div>)}
      </div>
    </div>
    <div className="mx-auto flex max-w-page flex-col gap-2 border-t border-line-soft px-5 py-6 text-[13px] text-fg-dim sm:flex-row sm:items-center sm:justify-between md:px-8">
      <p>© {new Date().getFullYear()} OUTARCH. All rights reserved.</p>
      <p>Built for Windows 11. Your code and terminals stay on your computer.</p>
    </div>
  </footer>;
}
