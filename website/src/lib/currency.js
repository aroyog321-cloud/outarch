import { useCallback, useEffect, useState } from 'react';

// Prices show in rupees for people in India and in dollars for everyone else.
// The guess comes from the browser's time zone (no location lookup); the
// visitor can switch, and the choice is remembered on this browser only.

const KEY = 'outarch-currency';
const INDIA_ZONES = new Set(['Asia/Kolkata', 'Asia/Calcutta']);

export function guessCurrency() {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === 'INR' || saved === 'USD') return saved;
  } catch { /* storage blocked: fall through to the guess */ }
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (INDIA_ZONES.has(zone)) return 'INR';
  } catch { /* no Intl time zone */ }
  const language = (navigator.languages || [navigator.language || '']).join(',');
  return /-IN\b/i.test(language) ? 'INR' : 'USD';
}

const listeners = new Set();
let current = null;

export function useCurrency() {
  const [currency, setState] = useState(() => (current ??= guessCurrency()));
  useEffect(() => {
    listeners.add(setState);
    return () => { listeners.delete(setState); };
  }, []);
  const setCurrency = useCallback(value => {
    current = value;
    try { window.localStorage.setItem(KEY, value); } catch { /* not remembered, still applied */ }
    listeners.forEach(listener => listener(value));
  }, []);
  return [currency, setCurrency];
}

export function formatMoney(amount, currency, { exact = false } = {}) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '';
  const whole = Number.isInteger(value);
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: whole && !exact ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}
