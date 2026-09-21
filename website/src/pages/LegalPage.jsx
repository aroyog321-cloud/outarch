import React from 'react';
import { Envelope, MapPin, Phone } from '@phosphor-icons/react';
import { Reveal } from '../components/ui.jsx';
import { useCatalog } from '../lib/catalog.js';
import { Link, useRouter } from '../lib/router.jsx';
import { SITE, operatorName } from '../lib/site.js';

// Terms, privacy, refunds, delivery and contact. Payment providers (Cashfree)
// review these pages before approving a merchant; the business details come
// from src/lib/site.js.

function useSupport() {
  const { supportEmail } = useCatalog();
  return SITE.supportEmail || supportEmail || '';
}

function ContactLine() {
  const email = useSupport();
  return email
    ? <>write to <a className="link-underline text-fg" href={`mailto:${email}`}>{email}</a></>
    : <>use the <Link className="link-underline text-fg" to="/contact">contact page</Link></>;
}

const H = ({ children }) => <h2 className="mt-12 text-[21px] font-semibold tracking-[-0.01em] text-fg">{children}</h2>;
const P = ({ children }) => <p className="mt-4 text-[15.5px] leading-[1.75] text-fg-muted">{children}</p>;
const UL = ({ items }) => <ul className="mt-4 space-y-2.5">{items.map(item => <li key={item} className="flex gap-3 text-[15.5px] leading-[1.7] text-fg-muted"><span className="mt-[11px] h-1 w-1 shrink-0 rounded-full bg-brand-sky"/>{item}</li>)}</ul>;

function Terms() {
  const name = operatorName();
  return <>
    <P>These terms cover your use of the OUTARCH desktop app, its website and your OUTARCH account, provided by {name}{SITE.address ? `, ${SITE.address}` : ''}. By creating an account or using the app you agree to them.</P>
    <H>Your account</H>
    <P>You need an account to use the desktop app. Keep your sign-in details to yourself; you are responsible for what happens under your account. You must be old enough to enter a contract where you live.</P>
    <H>The licence</H>
    <P>We give you a personal, non-exclusive, non-transferable licence to install and use OUTARCH on computers you control, within the limits of your plan. You may not resell the app, remove its plan checks, or use it to break the law or someone else's systems.</P>
    <H>Plans and payment</H>
    <UL items={[
      'The Free plan costs nothing. Pro and Ultimate are prepaid for one month or twelve months at the price shown when you pay.',
      'Payments are processed by Cashfree Payments. We do not see or store your card, UPI or bank details.',
      'A paid plan starts when the payment is confirmed and ends at the end of the period you bought. Nothing renews automatically.',
      'Buying the same plan again adds the new period to the end of the current one. Moving up from Pro to Ultimate carries over the Pro time left, converted at the monthly prices.',
      'Prices can change for future purchases. A period you have already paid for keeps its price.',
    ]}/>
    <H>Your code and data</H>
    <P>Your projects, code and terminal output stay on your computer and remain yours. OUTARCH does not claim any rights over them. The privacy policy explains the small amount of account data we keep.</P>
    <H>AI features</H>
    <P>Mission AI and the agents you run can be wrong. Review what they propose before approving it. OUTARCH asks for your approval before any AI-proposed change runs, but you remain responsible for what you approve.</P>
    <H>Availability and changes</H>
    <P>We work to keep the account service available but do not promise it will never be interrupted. The app keeps working offline for up to 72 hours on the last plan it confirmed. We may change or improve features; if a change takes away something you have paid for, contact us about a pro-rated refund.</P>
    <H>Warranty and liability</H>
    <P>OUTARCH is provided as is. To the extent the law allows, we are not liable for indirect or consequential losses, lost data or lost profits, and our total liability is limited to what you paid us in the twelve months before the claim.</P>
    <H>Ending your account</H>
    <P>You can stop using OUTARCH and ask us to delete your account at any time. We may suspend accounts that break these terms or misuse the service.</P>
    <H>Law</H>
    <P>These terms are governed by the laws of {SITE.jurisdiction}, and its courts have jurisdiction. If we change these terms we will update this page and the date above.</P>
    <H>Questions</H>
    <P>For anything about these terms, <ContactLine/>.</P>
  </>;
}

function Privacy() {
  const name = operatorName();
  return <>
    <P>{name} runs OUTARCH. This policy explains what the website, the account service and the desktop app collect, why, and what you can ask us to do with it.</P>
    <H>What stays on your computer</H>
    <P>Your projects, code, terminal output, workspace files, history and API keys stay on your computer. API keys are encrypted by Windows. None of this is sent to us.</P>
    <H>What we keep</H>
    <UL items={[
      'Account: your email address, and the name and picture Google shares if you sign in with Google.',
      'Plan: which plan you have, when it ends, and today\'s count of built-in Mission AI messages.',
      'Payments: order reference, plan, amount, currency, status and the payment method type. Card, UPI and bank details are handled by Cashfree and never reach us.',
      'Your mobile number is sent to Cashfree when you pay, because Cashfree requires it. We do not store it.',
    ]}/>
    <H>Mission AI</H>
    <P>When you use the built-in models, your question and a bounded, redacted summary of your workspace pass through our server to the AI provider (Google Gemini or NVIDIA) and back. We count the message against your plan but do not store its content. Terminal output is included only if you allow it. With your own API key, requests go from your computer straight to the provider you chose.</P>
    <H>Who processes data for us</H>
    <UL items={[
      'Supabase: account sign-in, database and server functions, hosted in Mumbai, India.',
      'Cashfree Payments: payment processing.',
      'Google: sign-in with Google, and Gemini for the built-in AI.',
      'NVIDIA: a built-in AI model provider.',
    ]}/>
    <H>Cookies and tracking</H>
    <P>This website uses no advertising or analytics trackers. It stores your sign-in session and your currency choice in your browser's local storage so they survive a reload.</P>
    <H>Your choices</H>
    <P>You can ask for a copy of your data, a correction, or the deletion of your account. Payment records we must keep for tax and accounting are kept for as long as the law requires. To ask, <ContactLine/>.</P>
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
    <P>To ask for a refund, <ContactLine/> with the email of your account and the order reference shown in your account's billing history. We reply within 2 working days.</P>
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
    <P>Open your account page to see the plan and the payment. If the payment shows as paid but the plan has not changed within 24 hours, <ContactLine/> with your order reference and we will switch it on or refund you.</P>
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
    <P>Questions about the app, your account, a payment or a refund: we answer within 2 working days.</P>
    <div className="mt-8 grid gap-4">
      {rows.length ? rows.map(([Icon, label, value]) => <div key={label} className="card flex items-center gap-4 p-5">
        <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-brand-blue/15 text-brand-sky"><Icon size={20} weight="duotone"/></span>
        <div><p className="text-[13px] text-fg-dim">{label}</p><p className="text-[16px]">{value}</p></div>
      </div>) : <div className="card p-5 text-[15px] text-fg-muted">Contact details are being added. Please check back shortly.</div>}
    </div>
    <P>For payment questions, include the email of your account and the order reference from your account's billing history.</P>
  </>;
}

const PAGES = {
  '/terms': ['Terms of service', Terms],
  '/privacy': ['Privacy policy', Privacy],
  '/refunds': ['Refunds and cancellation', Refunds],
  '/delivery': ['Delivery', Delivery],
  '/contact': ['Contact', Contact],
};

export default function LegalPage() {
  const { path } = useRouter();
  const [title, Body] = PAGES[path] || PAGES['/terms'];
  return <article className="mx-auto max-w-[760px] px-5 pb-24 pt-36 md:px-8">
    <Reveal><h1 className="display text-[clamp(2.2rem,5vw,3.6rem)]">{title}</h1></Reveal>
    {path !== '/contact' ? <Reveal delay={0.05}><p className="mt-4 text-[14px] text-fg-dim">Last updated {SITE.policiesUpdated}</p></Reveal> : null}
    <Reveal delay={0.08}><div className="mt-6"><Body/></div></Reveal>
    <nav className="mt-16 flex flex-wrap gap-2 border-t border-line-soft pt-8" aria-label="Policies">
      {Object.entries(PAGES).map(([to, [label]]) => <Link key={to} to={to} className={`chip ${to === path ? 'text-fg shadow-[inset_0_0_0_1px_rgba(106,166,255,0.6)]' : 'hover:text-fg'}`}>{label}</Link>)}
    </nav>
  </article>;
}
