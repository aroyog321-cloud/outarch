import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AndroidLogo, ArrowRight, CaretDown, Code, Copy, DeviceMobile, DownloadSimple, QrCode, ShieldCheck, WindowsLogo, Check,
} from '@phosphor-icons/react';
import { PlanCards, PricingControls } from '../components/Pricing.jsx';
import { Button, EASE, Reveal, SectionTitle, useSpotlight } from '../components/ui.jsx';
import { Wordmark } from '../components/Brand.jsx';
import { formatBytes, useCatalog } from '../lib/catalog.js';
import { useCurrency } from '../lib/currency.js';
import { Link } from '../lib/router.jsx';

// ------------------------------------------------------------------ pricing

export function PricingSection() {
  const catalog = useCatalog();
  const [currency, setCurrency] = useCurrency();
  const [period, setPeriod] = useState('month');
  return <section id="pricing" className="relative z-[1] mx-auto max-w-page scroll-mt-24 px-5 py-24 md:px-8">
    <div className="pointer-events-none absolute inset-x-0 top-24 mx-auto h-[420px] max-w-[900px] rounded-full bg-[radial-gradient(closest-side,rgba(155,123,255,0.14),transparent)]" aria-hidden="true"/>
    <SectionTitle align="center" kicker="Pricing" title="Start free. Upgrade when your stack grows." lede="Prepaid monthly or yearly plans. Pay once, the plan switches on the moment the payment clears, and nothing renews by itself."/>
    <Reveal delay={0.1} className="mt-10"><PricingControls period={period} setPeriod={setPeriod} currency={currency} setCurrency={setCurrency}/></Reveal>
    <div className="mt-10"><PlanCards plans={catalog.plans} prices={catalog.prices} period={period} currency={currency}/></div>
    <p className="mt-6 text-center text-[13.5px] text-fg-dim">*Unlimited Mission AI has a fair-use ceiling of 2,000 messages a day. Prices include no hidden fees; your bank may convert the currency. <Link to="/pricing#compare" className="link-underline text-fg-muted hover:text-fg">Compare every limit</Link></p>
  </section>;
}

// ------------------------------------------------------------------ download

function CopyLine({ text }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }).catch(() => {}); }} className="group flex w-full items-center gap-2 rounded-field bg-black/50 px-3 py-2.5 text-left font-term text-[12px] text-fg-soft shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]" aria-label={`Copy: ${text}`}>
    <span className="min-w-0 flex-1 truncate">{text}</span>
    {copied ? <Check size={15} className="text-brand-mint"/> : <Copy size={15} className="text-fg-dim group-hover:text-fg"/>}
  </button>;
}

export function DownloadSection() {
  const { release, androidApkUrl, loading } = useCatalog();
  const spotlight = useSpotlight();
  const published = release ? new Date(release.published_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  return <section id="download" className="relative z-[1] mx-auto max-w-page scroll-mt-24 px-5 py-24 md:px-8">
    <SectionTitle title="Get OUTARCH." lede="The desktop app is where everything runs. The phone companion and the VS Code bridge connect to it."/>
    <div className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <Reveal className="h-full">
        <article onPointerMove={spotlight} className="card spotlight relative flex h-full flex-col overflow-hidden p-7 sm:p-9">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,rgba(47,123,255,0.35),transparent)]"/>
          <div className="relative flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-brand-blue/15 text-brand-sky shadow-[inset_0_0_0_1px_rgba(47,123,255,0.4)]"><WindowsLogo size={24} weight="fill"/></span>
            <div>
              <h3 className="text-[22px] font-semibold">OUTARCH for Windows</h3>
              <p className="text-[14px] text-fg-muted">{release ? `Version ${release.version} · ${formatBytes(release.size_bytes)} · ${published}` : loading ? 'Checking for the latest version…' : 'Windows 11 · Free plan included'}</p>
            </div>
          </div>
          <ol className="relative mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              ['Download and extract the ZIP', 'Any folder works, for example D:\\Apps\\OUTARCH.'],
              ['Run OPEN_OUTARCH_WINDOWS.cmd', 'The first run installs the native terminal support. It needs Node.js 22 LTS.'],
              ['Sign in from the browser', 'Create a free account with email or Google. The browser hands you back to the app.'],
              ['Open your project', 'Add terminals and agents. Updates arrive on their own after that, signed and verified.'],
            ].map(([title, body], index) => <li key={title} className="flex gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/[0.06] font-mono text-[12.5px] text-fg-soft shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]">{index + 1}</span>
              <div className="min-w-0"><p className="text-[15px] font-medium [overflow-wrap:anywhere]">{title}</p><p className="mt-0.5 text-[13.5px] leading-relaxed text-fg-muted">{body}</p></div>
            </li>)}
          </ol>
          <div className="relative mt-auto pt-9">
            {release
              ? <div className="flex flex-wrap items-center gap-3">
                <Button href={release.download_url} size="lg" cursor="Download" download><DownloadSimple size={19} weight="bold"/>Download for Windows</Button>
                <a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer" className="link-underline text-[14px] text-fg-muted hover:text-fg">Get Node.js 22 LTS</a>
              </div>
              : <div className="rounded-field bg-white/[0.04] p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
                <p className="text-[15px] font-medium">{loading ? 'Looking up the latest build…' : 'The first public build is being prepared.'}</p>
                {!loading ? <p className="mt-1 text-[14px] text-fg-muted">The download appears here as soon as it is published. Create your free account now and you are ready to sign in on day one.</p> : null}
                {!loading ? <div className="mt-4"><Button to="/auth?mode=signup" variant="glass" size="sm">Create a free account<ArrowRight size={15}/></Button></div> : null}
              </div>}
            {release?.sha256 ? <p className="mt-4 flex items-center gap-2 font-mono text-[11.5px] text-fg-dim"><ShieldCheck size={14} className="text-brand-mint"/>SHA-256 {release.sha256.slice(0, 16)}…{release.sha256.slice(-8)}</p> : null}
          </div>
        </article>
      </Reveal>
      <div className="grid grid-cols-1 gap-5">
        <Reveal delay={0.06}>
          <article onPointerMove={spotlight} className="card spotlight relative overflow-hidden p-7" style={{ '--spot': '63,208,181' }}>
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-brand-mint/10 text-brand-mint shadow-[inset_0_0_0_1px_rgba(63,208,181,0.35)]"><DeviceMobile size={22} weight="duotone"/></span>
              <div><h3 className="text-[18px] font-semibold">Mobile companion</h3><p className="text-[13.5px] text-fg-muted">Pro and Ultimate</p></div>
            </div>
            <p className="mt-4 text-[14.5px] leading-relaxed text-fg-muted">Nothing to download from a store. In OUTARCH open <span className="text-fg-soft">Settings, Mobile companion</span>, scan the QR code with your phone on the same network, enter the 6-digit code and add it to your home screen.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="chip"><QrCode size={14}/>Pair by QR code</span>
              {androidApkUrl
                ? <a className="chip hover:text-fg" href={androidApkUrl}><AndroidLogo size={14} weight="fill"/>Android app (APK)</a>
                : <span className="chip"><AndroidLogo size={14} weight="fill"/>Android 13+ source included</span>}
            </div>
          </article>
        </Reveal>
        <Reveal delay={0.12}>
          <article onPointerMove={spotlight} className="card spotlight relative overflow-hidden p-7" style={{ '--spot': '155,123,255' }}>
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-brand-violet/10 text-brand-violet shadow-[inset_0_0_0_1px_rgba(155,123,255,0.35)]"><Code size={22} weight="duotone"/></span>
              <div><h3 className="text-[18px] font-semibold">VS Code bridge</h3><p className="text-[13.5px] text-fg-muted">Ultimate</p></div>
            </div>
            <p className="mt-4 text-[14.5px] leading-relaxed text-fg-muted">The extension ships inside the download. Install it once, then choose <span className="text-fg-soft">Connect VS Code</span> in OUTARCH Settings.</p>
            <div className="mt-4"><CopyLine text="code --install-extension integrations\vscode\mission-control-bridge-0.2.0.vsix"/></div>
          </article>
        </Reveal>
      </div>
    </div>
  </section>;
}

// ------------------------------------------------------------------ faq

const FAQ = [
  ['Is my code sent anywhere?', 'No. Your terminals, files and the engine run on your computer. Mission AI sends a bounded, redacted summary of your workspace to the model you choose only when you ask it something, and terminal output only if you allow it.'],
  ['Which AI agents does it work with?', 'Any agent with a command line runs in an OUTARCH terminal. Permission alerts recognise Claude Code, Codex, Gemini CLI, GitHub Copilot, Cursor, OpenCode, Goose and Aider, and the app has one-click setups for Claude Code, Codex, Gemini CLI and OpenCode.'],
  ['Does it run on macOS or Linux?', 'Not yet. The desktop app is built and tested for Windows 11. It needs Node.js 22 LTS, which the first run uses to install native terminal support.'],
  ['Why do I need an account?', 'Your plan lives on your account, so the app asks you to sign in once through the browser. After that it keeps working offline for up to 72 hours on the last plan it confirmed.'],
  ['How does paying work?', 'Plans are prepaid for one month or twelve. You pay on this website through Cashfree with UPI, cards or netbanking. The plan switches on as soon as the payment clears and the app picks it up within a few minutes, or at once if you press Open OUTARCH after paying. Nothing renews automatically; buy again to extend.'],
  ['Can I move from Pro to Ultimate?', 'Yes. Buy Ultimate and the Pro time you have left is carried over, converted at the two monthly prices, so you never pay twice for the same days.'],
  ['What happens when a plan ends?', 'Your account drops to Free. Projects, settings and history stay where they are; features above the Free limits lock until you buy again.'],
  ['Can I get a refund?', 'See the refund and cancellation policy for the details and how to ask.'],
];

function FaqItem({ question, answer, open, onToggle, index }) {
  return <div className="border-b border-line-soft">
    <h3>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`faq-${index}`} className="flex w-full items-center justify-between gap-6 py-5 text-left text-[16.5px] font-medium text-fg transition-colors hover:text-brand-sky">
        {question}
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.3, ease: EASE }} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[0.05] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"><CaretDown size={15}/></motion.span>
      </button>
    </h3>
    <AnimatePresence initial={false}>
      {open ? <motion.div id={`faq-${index}`} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: EASE }} className="overflow-hidden">
        <p className="max-w-[70ch] pb-6 text-[15px] leading-relaxed text-fg-muted">{answer}{index === FAQ.length - 1 ? <> <Link to="/refunds" className="link-underline text-fg-soft">Read the refund policy</Link>.</> : null}</p>
      </motion.div> : null}
    </AnimatePresence>
  </div>;
}

export function FaqSection() {
  const [open, setOpen] = useState(0);
  return <section id="faq" className="relative z-[1] mx-auto grid grid-cols-1 max-w-page scroll-mt-24 gap-12 px-5 py-24 md:px-8 lg:grid-cols-[0.8fr_1.2fr]">
    <div>
      <Reveal><h2 className="display text-[clamp(2rem,4.4vw,3.2rem)]">Questions, answered.</h2></Reveal>
      <Reveal delay={0.08}><p className="lede mt-5 text-[16.5px]">Anything else? Write to us from the <Link to="/contact" className="link-underline text-fg-soft">contact page</Link>.</p></Reveal>
    </div>
    <Reveal delay={0.1}>
      <div className="border-t border-line-soft">
        {FAQ.map(([question, answer], index) => <FaqItem key={question} index={index} question={question} answer={answer} open={open === index} onToggle={() => setOpen(open === index ? -1 : index)}/>)}
      </div>
    </Reveal>
  </section>;
}

// ------------------------------------------------------------------ final call to action

export function FinalCta() {
  return <section className="relative z-[1] overflow-hidden px-5 pb-16 pt-24 md:px-8">
    <div className="relative mx-auto max-w-page overflow-hidden rounded-[32px] bg-[linear-gradient(135deg,rgba(47,123,255,0.22),rgba(155,123,255,0.14)_45%,rgba(63,208,181,0.16))] px-6 py-20 text-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] sm:px-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_0%,rgba(255,255,255,0.12),transparent)]" aria-hidden="true"/>
      <Reveal><Wordmark auto className="mx-auto h-auto w-[min(560px,80vw)] cursor-pointer"/></Reveal>
      <Reveal delay={0.08}><p className="mx-auto mt-8 max-w-[46ch] text-[clamp(1.1rem,2vw,1.35rem)] text-fg-soft">Put every terminal and agent in one window, and stop checking on them by hand.</p></Reveal>
      <Reveal delay={0.14} className="mt-9 flex flex-wrap justify-center gap-3">
        <Button to="/#download" size="lg" cursor="Get it"><DownloadSimple size={19} weight="bold"/>Download for Windows</Button>
        <Button to="/pricing" size="lg" variant="glass">See pricing</Button>
      </Reveal>
    </div>
  </section>;
}
