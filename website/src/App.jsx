import React, { Suspense, lazy, useEffect } from 'react';
import Lenis from 'lenis';
import Backdrop from './components/Backdrop.jsx';
import Cursor from './components/Cursor.jsx';
import Footer from './components/Footer.jsx';
import Nav from './components/Nav.jsx';
import { Lockup } from './components/Brand.jsx';
import { Link, scrollToId, useRouter } from './lib/router.jsx';
import Home from './pages/Home.jsx';

// Pages other than the home page load on demand.
const PricingPage = lazy(() => import('./pages/PricingPage.jsx'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage.jsx'));
const AuthPage = lazy(() => import('./pages/AuthPage.jsx'));
const AccountPage = lazy(() => import('./pages/AccountPage.jsx'));
const LegalPage = lazy(() => import('./pages/LegalPage.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));

const LEGAL = new Set(['/terms', '/privacy', '/refunds', '/delivery', '/contact']);

function page(path) {
  if (path === '/') return Home;
  if (path === '/pricing') return PricingPage;
  if (path === '/checkout' || path === '/checkout/return') return CheckoutPage;
  if (path === '/auth') return AuthPage;
  if (path === '/account') return AccountPage;
  if (LEGAL.has(path)) return LegalPage;
  return NotFound;
}

const TITLES = {
  '/': 'OUTARCH | The command center for your terminals and AI agents',
  '/pricing': 'Pricing | OUTARCH',
  '/checkout': 'Checkout | OUTARCH',
  '/checkout/return': 'Payment | OUTARCH',
  '/auth': 'Sign in | OUTARCH',
  '/account': 'Your account | OUTARCH',
  '/terms': 'Terms of service | OUTARCH',
  '/privacy': 'Privacy policy | OUTARCH',
  '/refunds': 'Refunds and cancellation | OUTARCH',
  '/delivery': 'Delivery | OUTARCH',
  '/contact': 'Contact | OUTARCH',
};

function useSmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const lenis = new Lenis({ duration: 1.1, easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
    window.__lenis = lenis;
    let frame = 0;
    const loop = time => { lenis.raf(time); frame = requestAnimationFrame(loop); };
    frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); lenis.destroy(); window.__lenis = null; };
  }, []);
}

function PageFallback() {
  return <div className="grid min-h-[70dvh] place-items-center" role="status" aria-label="Loading">
    <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-brand-sky"/>
  </div>;
}

export default function App() {
  const { path, hash, query } = useRouter();
  const Page = page(path);
  // Signing in for the desktop app is a single-purpose page: no site navigation.
  const focused = path === '/auth' && query.get('client') === 'desktop';

  useSmoothScroll();
  useEffect(() => { document.title = TITLES[path] || 'OUTARCH'; }, [path]);
  useEffect(() => {
    if (!hash) return undefined;
    const timer = window.setTimeout(() => scrollToId(hash.slice(1)), 120);
    return () => window.clearTimeout(timer);
    // Only on first arrival at a page with a hash; in-page links scroll themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return <>
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[90] focus:rounded-full focus:bg-brand-blue focus:px-4 focus:py-2">Skip to content</a>
    <Backdrop/>
    <div className="grain" aria-hidden="true"/>
    <Cursor/>
    {focused
      ? <header className="relative z-[2] mx-auto flex h-20 max-w-page items-center px-5 md:px-8"><Link to="/" aria-label="OUTARCH home"><Lockup/></Link></header>
      : <Nav/>}
    <main id="main" className="relative z-[1]">
      <Suspense fallback={<PageFallback/>}>
        <Page/>
      </Suspense>
    </main>
    {focused ? null : <Footer/>}
  </>;
}
