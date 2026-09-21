import { website } from './supabase.js';

// The website's side of paying for a plan. Prices and the order itself are
// decided by the billing Edge Function from the database; the browser only
// says which plan, period and currency the person picked.

async function call(body) {
  const { data, error } = await website().functions.invoke('billing', { body });
  if (error) {
    let payload = null;
    try { payload = await error.context?.json?.(); } catch { payload = null; }
    const failure = new Error(payload?.error?.message || 'The payment service could not be reached. Check your connection and try again.');
    failure.code = payload?.error?.code || 'network';
    failure.status = error.context?.status;
    throw failure;
  }
  return data;
}

export const billing = {
  config: () => call({ action: 'config' }),
  create: input => call({ action: 'create', ...input }),
  verify: orderId => call({ action: 'verify', orderId }),
};

let sdk = null;
export async function loadCashfree(mode) {
  if (!sdk) sdk = import('@cashfreepayments/cashfree-js').then(module => module.load);
  const load = await sdk;
  return load({ mode: mode === 'production' ? 'production' : 'sandbox' });
}

// Ask until the order is settled, or give up after a while and let the page
// say so. The webhook applies the payment even if nobody is watching.
export async function waitForPayment(orderId, { tries = 12, gap = 2500, onTick } = {}) {
  let last = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    last = await billing.verify(orderId);
    onTick?.(last, attempt);
    if (last?.status === 'paid' || last?.status === 'expired') return last;
    if (last?.lastAttempt === 'FAILED' || last?.lastAttempt === 'USER_DROPPED') return last;
    await new Promise(resolve => setTimeout(resolve, gap));
  }
  return last;
}
