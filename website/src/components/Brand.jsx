import React, { useEffect, useId, useRef, useState } from 'react';

// OUTARCH's logo, drawn from the same letterform paths as the app's vector
// marks (scripts/brand/build-vector-marks.cjs). As inline SVG the glitch
// layers can move: the mint and blue ghosts shift and the cut band slides,
// on hover and now and then on its own. `live` keeps a quieter glitch running
// all the time (the navigation uses it); hover still plays the full burst.

const LETTERS = [
  ['0 0', 'M22 0H42A22 22 0 0 1 64 22V78A22 22 0 0 1 42 100H22A22 22 0 0 1 0 78V22A22 22 0 0 1 22 0Z M31 24A5 5 0 0 0 26 29V71A5 5 0 0 0 31 76H33A5 5 0 0 0 38 71V29A5 5 0 0 0 33 24Z'],
  ['72 0', 'M0 0H26V71A5 5 0 0 0 31 76A5 5 0 0 0 36 71V0H62V78A22 22 0 0 1 40 100H22A22 22 0 0 1 0 78Z'],
  ['142 0', 'M0 0H60V24H43V100H17V24H0Z'],
  ['210 0', 'M18 0H50L68 100H42L39.6 84H28.4L26 100H0Z M32 28L29.5 62H38.5L36 28Z'],
  ['286 0', 'M0 0H40A22 22 0 0 1 62 22V36A22 22 0 0 1 43.8 57.7L62 100H36L26 62V100H0Z M26 22V38H34A4 4 0 0 0 38 34V26A4 4 0 0 0 34 22Z'],
  ['356 0', 'M22 0H38A22 22 0 0 1 60 22V36H34V28A4 4 0 0 0 30 24A4 4 0 0 0 26 28V72A4 4 0 0 0 30 76A4 4 0 0 0 34 72V64H60V78A22 22 0 0 1 38 100H22A22 22 0 0 1 0 78V22A22 22 0 0 1 22 0Z'],
  ['424 0', 'M0 0H26V38H36V0H62V100H36V62H26V100H0Z'],
];

const O_PATH = LETTERS[0][1];

function useGlitch(auto) {
  const [on, setOn] = useState(false);
  const timer = useRef(0);
  const trigger = () => {
    setOn(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOn(false), 620);
  };
  useEffect(() => {
    if (!auto || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const every = window.setInterval(trigger, 5200 + Math.random() * 2600);
    return () => { window.clearInterval(every); window.clearTimeout(timer.current); };
  }, [auto]);
  return [on, trigger];
}

export function Wordmark({ className = '', auto = false, live = false, title = 'OUTARCH' }) {
  const raw = useId().replace(/:/g, '');
  const ids = { w: `w${raw}`, keep: `k${raw}`, band: `b${raw}`, cuts: `c${raw}` };
  const [glitching, trigger] = useGlitch(auto);
  return <svg
    className={`wordmark ${live ? 'wordmark--live' : ''} ${glitching ? 'is-glitching' : ''} ${className}`}
    viewBox="-22 -2 536 112"
    role="img"
    aria-label={title}
    onPointerEnter={trigger}
  >
    <defs>
      <g id={ids.w} fillRule="evenodd">{LETTERS.map(([at, d]) => <path key={at} transform={`translate(${at})`} d={d}/>)}</g>
      <clipPath id={ids.keep}><rect x="-22" y="-2" width="536" height="58"/><rect x="-22" y="61" width="536" height="51"/><rect x="-22" y="56" width="140" height="5"/><rect x="286" y="56" width="536" height="5"/></clipPath>
      <clipPath id={ids.band}><rect x="140" y="56" width="146" height="5"/></clipPath>
      <mask id={ids.cuts} maskUnits="userSpaceOnUse" x="-22" y="-2" width="536" height="112"><rect x="-22" y="-2" width="536" height="112" fill="#fff"/><rect x="0" y="33" width="118" height="2.2" fill="#000"/><rect x="300" y="72" width="130" height="2.2" fill="#000"/></mask>
    </defs>
    <g className="wordmark__mint"><use href={`#${ids.w}`} fill="#3fd0b5" transform="translate(-3 2)" opacity=".55"/></g>
    <g className="wordmark__blue"><use href={`#${ids.w}`} fill="#2f7bff" transform="translate(6 4)"/></g>
    <g fill="#f6f8fc" mask={`url(#${ids.cuts})`}>
      <use href={`#${ids.w}`} clipPath={`url(#${ids.keep})`}/>
      <g className="wordmark__band" clipPath={`url(#${ids.band})`}><use href={`#${ids.w}`} transform="translate(6 0)"/></g>
    </g>
    <rect className="wordmark__dash wordmark__dash--l" x="-22" y="45" width="30" height="5" fill="#2f7bff"/>
    <rect className="wordmark__dash wordmark__dash--r" x="478" y="53" width="36" height="4" fill="#2f7bff"/>
  </svg>;
}

// The app icon: the glitch O on its rounded black tile.
export function BrandIcon({ size = 32, className = '' }) {
  const raw = useId().replace(/:/g, '');
  const tile = `t${raw}`;
  const top = `p${raw}`;
  const band = `b${raw}`;
  return <svg className={`brand-icon ${className}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id={tile} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#161a22"/><stop offset="1" stopColor="#050608"/></linearGradient>
      <clipPath id={top}><rect width="64" height="26.5"/><rect y="30" width="64" height="34"/></clipPath>
      <clipPath id={band}><rect y="26.5" width="64" height="3.5"/></clipPath>
    </defs>
    <rect x=".5" y=".5" width="63" height="63" rx="15" fill={`url(#${tile})`} stroke="#fff" strokeOpacity=".14"/>
    <g className="brand-icon__ghost"><path fill="#2f7bff" fillRule="evenodd" transform="translate(19.16 10.1) scale(0.47)" d={O_PATH}/></g>
    <g clipPath={`url(#${top})`}><path fill="#f6f8fc" fillRule="evenodd" transform="translate(16.96 8.5) scale(0.47)" d={O_PATH}/></g>
    <g clipPath={`url(#${band})`}><path fill="#f6f8fc" fillRule="evenodd" transform="translate(19.56 8.5) scale(0.47)" d={O_PATH}/></g>
    <rect x="9" y="37.5" width="12" height="2.6" rx=".6" fill="#2f7bff"/>
    <rect x="44" y="19.5" width="9" height="2" rx=".5" fill="#f6f8fc"/>
  </svg>;
}

// The mark and name together, for the navigation and footers.
export function Lockup({ className = '' }) {
  return <span className={`inline-flex items-center gap-2.5 ${className}`}>
    <BrandIcon size={30}/>
    <Wordmark className="h-[15px] w-auto"/>
  </span>;
}
