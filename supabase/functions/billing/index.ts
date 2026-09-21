// OUTARCH billing: Cashfree checkout for the Pro and Ultimate plans.
//
// The website calls this with the signed-in user's session:
//   { action: "config" }
//       whether online payment is switched on, sandbox or production, and
//       which currencies the Cashfree account can charge.
//   { action: "create", plan, period, currency, phone, name }
//       prices the purchase from public.plan_prices (never from the browser),
//       records it in public.payments and opens a Cashfree order. Returns the
//       payment_session_id the Cashfree checkout needs.
//   { action: "verify", orderId }
//       asks Cashfree whether that order is paid. If it is, the plan is
//       switched on by public.apply_payment().
//
// The cashfree-webhook function switches the plan on as well, so a payment
// finished in a tab that was then closed still counts. apply_payment is
// idempotent, so both reporting the same order is harmless.
//
// Secrets (Supabase dashboard > Edge Functions > Secrets):
//   CASHFREE_CLIENT_ID, CASHFREE_CLIENT_SECRET  Cashfree dashboard > Developers > API keys
//   CASHFREE_ENV         "sandbox" (default) or "production"
//   CASHFREE_CURRENCIES  what the account may charge, default "INR". Add USD
//                        ("INR,USD") once Cashfree enables international payments.
//   SITE_URL             optional, the website address; defaults to app_config.website_url

import { createClient } from "npm:@supabase/supabase-js@2";

const API_VERSION = "2025-01-01";
const PLANS = new Set(["pro", "ultimate"]);
const PERIODS = new Set(["month", "year"]);
const CURRENCIES = new Set(["INR", "USD"]);
const ORDER_ID = /^oa_[A-Za-z0-9_-]{8,40}$/;
const ORDER_LIFETIME_MS = 45 * 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function refuse(status: number, code: string, message: string): Response {
  return reply(status, { error: { code, message } });
}

type CashfreeEnv = "sandbox" | "production";

function settings() {
  const clientId = Deno.env.get("CASHFREE_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("CASHFREE_CLIENT_SECRET") || "";
  const env: CashfreeEnv = (Deno.env.get("CASHFREE_ENV") || "").trim().toLowerCase() === "production" ? "production" : "sandbox";
  const currencies = (Deno.env.get("CASHFREE_CURRENCIES") || "INR")
    .split(",").map((item) => item.trim().toUpperCase()).filter((item) => CURRENCIES.has(item));
  if (!currencies.includes("INR")) currencies.unshift("INR");
  return { clientId, clientSecret, env, currencies, enabled: Boolean(clientId && clientSecret) };
}

async function cashfree(config: ReturnType<typeof settings>, path: string, init: RequestInit = {}) {
  const base = config.env === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-api-version": API_VERSION,
      "x-client-id": config.clientId,
      "x-client-secret": config.clientSecret,
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) {
    const message = String(body?.message || `Cashfree answered ${response.status}`).slice(0, 300);
    const error = new Error(message) as Error & { status?: number; code?: string };
    error.status = response.status;
    error.code = String(body?.code || body?.type || "cashfree_error");
    throw error;
  }
  return body;
}

// Cashfree wants 10 digits for an Indian number and "+<country><number>" for
// any other. Returns null for anything that is not a plausible phone number.
function normalisePhone(value: unknown): string | null {
  const raw = String(value ?? "").replace(/[\s().-]/g, "");
  if (/^[6-9]\d{9}$/.test(raw)) return raw;
  const india = raw.match(/^(?:\+91|0091|91)([6-9]\d{9})$/);
  if (india) return india[1];
  if (/^\+[1-9]\d{7,14}$/.test(raw)) return raw;
  return null;
}

function newOrderId(): string {
  return `oa_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function siteUrl(admin: ReturnType<typeof createClient>): Promise<string> {
  const configured = (Deno.env.get("SITE_URL") || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  const { data } = await admin.from("app_config").select("value").eq("key", "website_url").maybeSingle();
  return typeof data?.value === "string" ? data.value.replace(/\/+$/, "") : "";
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return refuse(405, "method", "Use POST.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return refuse(500, "server", "The billing service is not configured.");
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: userData } = token ? await admin.auth.getUser(token) : { data: null };
  const user = userData?.user;
  if (!user) return refuse(401, "signed_out", "Sign in to OUTARCH first.");

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return refuse(400, "bad_request", "The request was not valid JSON."); }

  const config = settings();
  const action = String(body.action || "");

  if (action === "config") {
    return reply(200, { enabled: config.enabled, mode: config.env, currencies: config.currencies });
  }
  if (!config.enabled) {
    return refuse(503, "payments_not_configured", "Online payment is not switched on yet.");
  }

  if (action === "create") {
    const plan = String(body.plan || "");
    const period = String(body.period || "");
    const wanted = String(body.currency || "INR").toUpperCase();
    if (!PLANS.has(plan)) return refuse(400, "plan", "Choose Pro or Ultimate.");
    if (!PERIODS.has(period)) return refuse(400, "period", "Choose monthly or yearly.");
    const currency = config.currencies.includes(wanted) ? wanted : "INR";
    const phone = normalisePhone(body.phone);
    if (!phone) return refuse(400, "phone", "Enter a valid mobile number. Numbers outside India start with + and the country code.");
    const name = String(body.name || user.user_metadata?.full_name || "").trim().slice(0, 100);

    const { data: price } = await admin.from("plan_prices").select("amount,months")
      .eq("plan_id", plan).eq("period", period).eq("currency", currency).eq("active", true).maybeSingle();
    if (!price) return refuse(409, "price", "That plan is not for sale in this currency right now.");

    const { data: outcome, error: outcomeError } = await admin.rpc("purchase_outcome", { p_user: user.id, p_plan: plan, p_months: price.months });
    if (outcomeError) return refuse(500, "server", "Your plan could not be checked. Try again in a moment.");
    if (outcome?.blocked) return refuse(409, "blocked", String(outcome.reason || "This purchase is not available on your account."));

    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await admin.from("payments").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).gte("created_at", since);
    if ((count || 0) >= 10) return refuse(429, "rate_limited", "Too many checkouts in a few minutes. Wait a little and try again.");

    const orderId = newOrderId();
    const { data: planRow } = await admin.from("plans").select("name").eq("id", plan).maybeSingle();
    const { error: insertError } = await admin.from("payments").insert({
      id: orderId, user_id: user.id, plan_id: plan, period, months: price.months,
      currency, amount: price.amount, provider: "cashfree", environment: config.env,
    });
    if (insertError) return refuse(500, "server", "The order could not be recorded. Try again.");

    const site = await siteUrl(admin);
    const orderMeta: Record<string, string> = { notify_url: `${supabaseUrl}/functions/v1/cashfree-webhook` };
    // Cashfree accepts only https return addresses; a local preview uses the pop-up checkout alone.
    if (site.startsWith("https://")) orderMeta.return_url = `${site}/checkout/return?order_id={order_id}`;

    try {
      const order = await cashfree(config, "/orders", {
        method: "POST",
        headers: { "x-idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          order_id: orderId,
          order_amount: Number(price.amount),
          order_currency: currency,
          customer_details: {
            customer_id: user.id.replace(/-/g, ""),
            customer_phone: phone,
            customer_email: user.email || undefined,
            customer_name: name.length >= 3 ? name : undefined,
          },
          order_meta: orderMeta,
          order_expiry_time: new Date(Date.now() + ORDER_LIFETIME_MS).toISOString(),
          order_note: `OUTARCH ${planRow?.name || plan}, ${period === "year" ? "12 months" : "1 month"}`,
          order_tags: { plan, period, months: String(price.months) },
        }),
      });
      await admin.from("payments").update({ provider_order_id: String(order?.cf_order_id ?? "") || null }).eq("id", orderId);
      return reply(200, {
        orderId,
        paymentSessionId: order?.payment_session_id,
        mode: config.env,
        amount: Number(price.amount),
        currency,
        outcome,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await admin.from("payments").update({ status: "failed", last_event: `create: ${message}`.slice(0, 300) }).eq("id", orderId);
      return refuse(502, "cashfree", `The payment could not be started: ${message}`);
    }
  }

  if (action === "verify") {
    const orderId = String(body.orderId || "");
    if (!ORDER_ID.test(orderId)) return refuse(400, "order", "That order reference is not valid.");
    const { data: payment } = await admin.from("payments").select("*").eq("id", orderId).eq("user_id", user.id).maybeSingle();
    if (!payment) return refuse(404, "order", "No order with that reference belongs to your account.");
    if (payment.status === "paid") {
      return reply(200, { status: "paid", orderId, planId: payment.plan_id, periodEnd: payment.period_end });
    }

    let order: any;
    try {
      order = await cashfree(config, `/orders/${encodeURIComponent(orderId)}`, { method: "GET" });
    } catch (error) {
      return refuse(502, "cashfree", `Cashfree could not be asked about this payment: ${error instanceof Error ? error.message : String(error)}`);
    }
    const status = String(order?.order_status || "");

    if (status === "PAID") {
      let paymentId: string | null = null;
      let method: string | null = null;
      try {
        const attempts = await cashfree(config, `/orders/${encodeURIComponent(orderId)}/payments`, { method: "GET" });
        const success = Array.isArray(attempts) ? attempts.find((item) => item?.payment_status === "SUCCESS") : null;
        paymentId = success?.cf_payment_id ? String(success.cf_payment_id) : null;
        method = success?.payment_group ? String(success.payment_group) : null;
      } catch { /* the order status alone is proof of payment */ }
      const { data: applied, error: applyError } = await admin.rpc("apply_payment", {
        p_order: orderId, p_payment_id: paymentId, p_method: method,
        p_amount: Number(order.order_amount), p_currency: String(order.order_currency || payment.currency),
      });
      if (applyError) return refuse(500, "apply", "Your payment went through but the plan did not switch on. It will be retried automatically; contact support if it has not changed in a few minutes.");
      return reply(200, { status: "paid", orderId, planId: applied?.planId, periodEnd: applied?.periodEnd });
    }

    if (status === "EXPIRED" || status === "TERMINATED") {
      await admin.from("payments").update({ status: "expired", last_event: status }).eq("id", orderId).eq("status", "created");
      return reply(200, { status: "expired", orderId });
    }

    // Still open: tell the page whether the last attempt failed, so it can offer to try again.
    let lastAttempt: string | null = null;
    try {
      const attempts = await cashfree(config, `/orders/${encodeURIComponent(orderId)}/payments`, { method: "GET" });
      if (Array.isArray(attempts) && attempts.length) lastAttempt = String(attempts[0]?.payment_status || "") || null;
    } catch { /* not knowing is fine */ }
    return reply(200, { status: "pending", orderId, lastAttempt });
  }

  return refuse(400, "action", "Unknown action.");
});
