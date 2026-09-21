// OUTARCH cashfree-webhook: Cashfree reports payments here, server to server.
//
// Every request must carry Cashfree's signature: base64 HMAC-SHA256 of
// x-webhook-timestamp + the raw body, keyed with the Cashfree client secret.
// A verified PAYMENT_SUCCESS_WEBHOOK for an OUTARCH order switches the plan
// on through public.apply_payment(), which checks the amount and currency
// against the order and does nothing if the order was already applied.
//
// Point Cashfree at it in the dashboard (Developers > Webhooks) as well:
//   https://<project>.supabase.co/functions/v1/cashfree-webhook
// Orders created by the billing function also name it as their notify_url.
//
// Deployed with JWT verification off: Cashfree cannot send a Supabase token,
// and the signature is the authentication.

import { createClient } from "npm:@supabase/supabase-js@2";

const ORDER_ID = /^oa_[A-Za-z0-9_-]{8,40}$/;

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

function ok(note: string): Response {
  return new Response(JSON.stringify({ ok: true, note }), { status: 200, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Use POST", { status: 405 });

  const secret = Deno.env.get("CASHFREE_CLIENT_SECRET") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !supabaseUrl || !serviceKey) return new Response("Payments are not configured", { status: 503 });

  const raw = await request.text();
  const signature = request.headers.get("x-webhook-signature") || "";
  const timestamp = request.headers.get("x-webhook-timestamp") || "";
  if (!signature || !timestamp || !sameText(await sign(secret, timestamp + raw), signature)) {
    return new Response("Signature does not match", { status: 401 });
  }

  let event: any;
  try { event = JSON.parse(raw); } catch { return new Response("Not JSON", { status: 400 }); }
  const type = String(event?.type || "");
  const orderId = String(event?.data?.order?.order_id || "");
  // Dashboard test pings and orders that are not OUTARCH's are acknowledged and ignored.
  if (!ORDER_ID.test(orderId)) return ok("ignored");

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const payment = event?.data?.payment || {};

  if (type === "PAYMENT_SUCCESS_WEBHOOK" && payment.payment_status === "SUCCESS") {
    const { error } = await admin.rpc("apply_payment", {
      p_order: orderId,
      p_payment_id: payment.cf_payment_id ? String(payment.cf_payment_id) : null,
      p_method: payment.payment_group ? String(payment.payment_group) : null,
      p_amount: Number(payment.payment_amount ?? event?.data?.order?.order_amount),
      p_currency: String(payment.payment_currency || event?.data?.order?.order_currency || ""),
    });
    if (error) {
      // Not one of this project's orders (for example a sandbox order sent to
      // the live project): acknowledge it so Cashfree stops sending it.
      if (error.code === "P0002") return ok("unknown order");
      console.error("apply_payment failed", orderId, error.message);
      await admin.from("payments").update({ last_event: `webhook apply failed: ${error.message}`.slice(0, 300) }).eq("id", orderId);
      // An amount or currency that does not match the order needs a person, not a retry.
      if (/does not match/.test(error.message)) return ok("held for review");
      // Anything else may be passing: a 5xx makes Cashfree deliver the event again.
      return new Response("Could not apply the payment", { status: 500 });
    }
    return ok("applied");
  }

  if (type === "PAYMENT_FAILED_WEBHOOK" || type === "PAYMENT_USER_DROPPED_WEBHOOK") {
    const reason = String(payment.payment_message || type).slice(0, 200);
    await admin.from("payments").update({ last_event: `${type}: ${reason}`.slice(0, 300) }).eq("id", orderId).eq("status", "created");
    return ok("noted");
  }

  return ok("ignored");
});
