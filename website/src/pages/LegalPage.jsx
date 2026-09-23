import React from 'react';
import { ArrowRight, Envelope, MapPin, Phone } from '@phosphor-icons/react';
import { Reveal } from '../components/ui.jsx';
import { useCatalog } from '../lib/catalog.js';
import { Link, useRouter } from '../lib/router.jsx';
import { SITE, operatorName } from '../lib/site.js';
import { LEGAL_UPDATED, POLICIES, fillPolicyText, policyByPath } from '../legal/outarchPolicies.js';

// The Legal & privacy section. The policy text is shared with the desktop app
// (src/legal/outarchPolicies.js, copied from the app by scripts/sync-legal.cjs),
// so the site and Settings > Legal & privacy always say the same thing. The
// business details come from src/lib/site.js.
//
// Refunds, delivery and contact are the pages the payment provider reviews;
// they predate the shared policies and stay as they were.

function useSupport() {
  const { supportEmail } = useCatalog();
  return SITE.supportEmail || supportEmail || '';
}

function ContactLine() {
  const email = useSupport();
  return email
    ? <a className="link-underline text-fg" href={`mailto:${email}`}>{email}</a>
    : <>us through the <Link className="link-underline text-fg" to="/contact">contact page</Link></>;
}

const H = ({ children, id }) => <h2 id={id} className="mt-12 scroll-mt-28 text-[21px] font-semibold tracking-[-0.01em] text-fg">{children}</h2>;
const P = ({ children }) => <p className="mt-4 text-[15.5px] leading-[1.75] text-fg-muted">{children}</p>;
const UL = ({ items }) => <ul className="mt-4 space-y-2.5">{items.map((item, index) => <li key={index} className="flex gap-3 text-[15.5px] leading-[1.7] text-fg-muted"><span className="mt-[11px] h-1 w-1 shrink-0 rounded-full bg-brand-sky"/><span>{item}</span></li>)}</ul>;

const slug = text => String(text).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Fills the operator and jurisdiction, and turns {contact} into a real link.
function Rich({ text }) {
  const filled = fillPolicyText(text, { operator: operatorName(), jurisdiction: SITE.jurisdiction });
  const parts = filled.split('{contact}');
  return parts.map((part, index) => <React.Fragment key={index}>{part}{index < parts.length - 1 ? <ContactLine/> : null}</React.Fragment>);
}

function PolicyBody({ policy }) {
  return <>
    {policy.sections.length > 4 ? <nav aria-label="On this page" className="mt-8 rounded-card p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
      <p className="text-[12.5px] font-medium uppercase tracking-[0.12em] text-fg-dim">On this page</p>
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {policy.sections.map(section => <li key={section.heading}><Link to={`${policy.path}#${slug(section.heading)}`} className="link-underline text-[14px] text-fg-muted hover:text-fg">{section.heading}</Link></li>)}
      </ul>
    </nav> : null}
    {policy.sections.map(section => <section key={section.heading}>
      <H id={slug(section.heading)}>{section.heading}</H>
      {section.blocks.map((block, index) => Array.isArray(block)
        ? <UL key={index} items={block.map((item, at) => <Rich key={at} text={item}/>)}/>
        : <P key={index}><Rich text={block}/></P>)}
    </section>)}
  </>;
}

// /legal: every policy, one card each.
function LegalHub() {
  return <>
    <P>How OUTARCH works with your code and your data, in plain words. The same documents are in the desktop app under Settings, Legal & privacy, so you can read them without opening this site.</P>
    <div className="mt-10 grid gap-3 sm:grid-cols-2">
      {POLICIES.map(policy => <Link key={policy.id} to={policy.path} className="card group flex flex-col gap-2 p-5 transition-colors hover:bg-white/[0.03]">
        <span className="flex items-center justify-between gap-3 text-[16px] font-medium text-fg">{policy.title}<ArrowRight size={16} className="shrink-0 text-fg-dim transition-transform group-hover:translate-x-0.5 group-hover:text-fg"/></span>
        <span className="text-[14px] leading-relaxed text-fg-muted"><Rich text={policy.summary}/></span>
      </Link>)}
    </div>
    <H>Questions</H>
    <P>For anything about these documents, or to use your privacy rights, contact <ContactLine/>.</P>
  </>;
}

function Refunds() {
  return <>
    <P>OUTARCH plans are prepaid digital services that switch on as soon as payment is confirmed. This policy explains when you can get your money back and how to cancel.</P>
    <H>Cancelling</H>
    <P>There is no subscription to cancel: plans do not renew automatically. If you do not buy again, your plan ends on the date shown in your account and you move to the Free plan.</P>
    <H>When you get a full refund</H>
    <UL items={[
      'You were charged twice for the same order.',
      'You were charged but your plan did not switch on, and we cannot fix it within 24 hours.',
      'Your first purchase, if you ask within 7 days of paying.',
    ]}/>
    <H>Other requests</H>
    <P>After 7 days, and for later purchases, paid periods are not refunded, except where a change on our side takes away a feature you paid for; then we refund the unused part.</P>
    <H>How to ask</H>
    <P>To ask for a refund, write to <ContactLine/> with the email of your account and the order reference shown in your account's billing history. We reply within 2 working days.</P>
    <H>When the money arrives</H>
    <P>Approved refunds are sent back to the original payment method through Cashfree within 7 working days. Your bank may take a few more days to show it.</P>
  </>;
}

function Delivery() {
  return <>
    <P>OUTARCH is software and a digital service. Nothing is shipped physically.</P>
    <H>How you receive it</H>
    <UL items={[
      'The desktop app is downloaded from this website and is free to install.',
      'A paid plan is delivered to your OUTARCH account the moment Cashfree confirms your payment, usually within a few seconds.',
      'The desktop app reads your plan when it starts, when its window gets focus, and every five minutes. Pressing Open OUTARCH after paying makes it check straight away.',
    ]}/>
    <H>If your plan does not appear</H>
    <P>Open your account page to see the plan and the payment. If the payment shows as paid but the plan has not changed within 24 hours, write to <ContactLine/> with your order reference and we will switch it on or refund you.</P>
  </>;
}

function Contact() {
  const email = useSupport();
  const rows = [
    email ? [Envelope, 'Email', <a key="e" className="link-underline text-fg" href={`mailto:${email}`}>{email}</a>] : null,
    SITE.supportPhone ? [Phone, 'Phone', <a key="p" className="link-underline text-fg" href={`tel:${SITE.supportPhone.replace(/\s/g, '')}`}>{SITE.supportPhone}</a>] : null,
    SITE.address ? [MapPin, 'Address', <span key="a" className="text-fg">{operatorName()}, {SITE.address}</span>] : null,
  ].filter(Boolean);
  return <>
    <P>Questions about the app, your account, your data, a payment or a security issue: we answer within 2 working days.</P>
    <div className="mt-8 grid gap-4">
      {rows.length ? rows.map(([Icon, label, value]) => <div key={label} className="card flex items-center gap-4 p-5">
        <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-brand-blue/15 text-brand-sky"><Icon size={20} weight="duotone"/></span>
        <div><p className="text-[13px] text-fg-dim">{label}</p><p className="text-[16px]">{value}</p></div>
      </div>) : <div className="card p-5 text-[15px] text-fg-muted">Contact details are being added. Please check back shortly.</div>}
    </div>
    <P>For payment questions, include the email of your account and the order reference from your account's billing history. To report a security vulnerability, put "Security" in the subject and see the <Link className="link-underline text-fg" to="/security">security policy</Link>. To delete your account or ask about your data, write from the email address on your account.</P>
  </>;
}

const OTHER_PAGES = {
  '/legal': ['Legal & privacy', LegalHub],
  '/refunds': ['Refunds and cancellation', Refunds],
  '/delivery': ['Delivery', Delivery],
  '/contact': ['Contact', Contact],
};

export default function LegalPage() {
  const { path } = useRouter();
  const policy = policyByPath(path);
  const [title, Body] = policy ? [policy.title, null] : OTHER_PAGES[path] || OTHER_PAGES['/legal'];
  const dated = path !== '/contact' && path !== '/legal';
  return <article className="mx-auto max-w-[760px] px-5 pb-24 pt-36 md:px-8">
    <Reveal>
      {path !== '/legal' ? <Link to="/legal" className="text-[13.5px] text-fg-dim hover:text-fg">Legal & privacy</Link> : null}
      <h1 className="display mt-2 text-[clamp(2.2rem,5vw,3.6rem)]">{title}</h1>
    </Reveal>
    {dated ? <p className="mt-4 text-[14px] text-fg-dim">Last updated {policy ? LEGAL_UPDATED : SITE.policiesUpdated}</p> : null}
    {/* The body is not wrapped in Reveal: a policy is taller than the screen, and
        an in-view threshold on something that tall would never be reached. */}
    <div className="mt-6">{policy ? <PolicyBody policy={policy}/> : <Body/>}</div>
    <nav className="mt-16 flex flex-wrap gap-2 border-t border-line-soft pt-8" aria-label="Policies">
      {[['/legal', 'All policies'], ...POLICIES.map(item => [item.path, item.title]), ['/contact', 'Contact']].map(([to, label]) => <Link key={to} to={to} aria-current={to === path ? 'page' : undefined} className={`chip ${to === path ? 'text-fg shadow-[inset_0_0_0_1px_rgba(106,166,255,0.6)]' : 'hover:text-fg'}`}>{label}</Link>)}
    </nav>
  </article>;
}
