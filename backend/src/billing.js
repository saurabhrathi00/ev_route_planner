/* Subscriptions, built and switched off.
 *
 * Nothing here runs until a product id and a service account exist. That is the
 * same rule attestation follows and for the same reason: a flag that says
 * "charge people" while the credentials to check a purchase are missing is a
 * service that refuses paying customers, and the other setting of that flag is
 * one that gives everything away while claiming not to. Deriving it from the
 * credentials makes both impossible.
 *
 * WHAT IS PAID FOR
 *
 * Not the app, and not planning. The physics runs on the phone and costs
 * nothing to run; charging for it would be charging for arithmetic. What costs
 * real money per use is the Google charger lookup with live bay counts —
 * Enterprise-tier, about ₹1 a call — and that is the one thing gated.
 *
 * Past the free allowance the service answers `degraded`, which the app already
 * knows how to handle: it falls through to Open Charge Map and OpenStreetMap,
 * exactly as when Google is out of quota or switched off in Settings. So a
 * driver who runs out of free plans still gets a plan, with chargers, from the
 * open sources. They lose ratings and live bay counts, which is precisely the
 * thing that costs money to provide.
 *
 * WHAT COUNTS AS ONE
 *
 * A plan, not a call. One 500 km corridor is six or seven Nearby lookups and
 * charging six would make the allowance meaningless and unexplainable. The app
 * stamps every request of a single planning run with the same plan id, and the
 * first one through the door is what gets counted.
 *
 * THE IDENTIFIER, HONESTLY
 *
 * Counting per person needs something that says which person, and there are no
 * accounts. The app generates a random install id, stores it on the device, and
 * sends it; the service keeps only a hash. It identifies an installation, not a
 * human — reinstalling produces a new one and resets the allowance. That is a
 * known hole and an accepted one: the alternative is an account, which costs
 * more in signups lost than it saves in free plans given, and PRIVACY.md would
 * have to describe something far worse than a counter.
 */

const MONTH = () => new Date().toISOString().slice(0, 7);      // YYYY-MM

/** Free Google-charger plans per install per month, unless the env says otherwise. */
const DEFAULT_FREE = 15;

/* One id in, one opaque key out. The install id is the app's own random string
 * and identifies nothing by itself, but it is still the only per-person thing
 * this service sees — so it is hashed on arrival, the same way IP addresses are
 * in limits.js, and what is stored cannot be matched back against a device. */
async function tag(id) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`install:${id}`));
  return [...new Uint8Array(digest).slice(0, 10)]
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

export const billing = env => !!(env.BILLING_PRODUCT && env.SERVICE_ACCOUNT);

export function freeAllowance(env) {
  const n = parseInt(env.FREE_PLANS || '', 10);
  return isFinite(n) && n > 0 ? n : DEFAULT_FREE;
}

/* Google's word on a purchase, asked of Google.
 *
 * Never the client's. An app can be patched to claim anything, and the whole
 * reason this check lives on a server is that the phone is not a place to make
 * a decision the phone benefits from. */
export async function checkPurchase(env, token, googleToken) {
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/`
    + `${env.BILLING_PACKAGE || 'com.evroute.app'}/purchases/subscriptionsv2/tokens/`
    + encodeURIComponent(token);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${await googleToken(env)}` } });
  if (!r.ok) {
    let detail = '';
    try { detail = JSON.stringify(await r.json()).slice(0, 300); } catch { /* not json */ }
    console.warn(`purchase check ${r.status} ${detail}`);
    const e = new Error('could not check that purchase');
    e.status = r.status === 404 ? 404 : 502;
    throw e;
  }
  const p = await r.json();

  /* ACTIVE and IN_GRACE_PERIOD both mean "let them in". A grace period is
   * Google retrying a failed card, and locking someone out mid-journey over a
   * bank's decline is a support ticket and a one-star review for a problem that
   * usually fixes itself in a day. */
  const state = p.subscriptionState || '';
  const active = state === 'SUBSCRIPTION_STATE_ACTIVE' || state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD';
  const line = (p.lineItems || [])[0] || {};
  return {
    active,
    state,
    product: line.productId || null,
    until: line.expiryTime ? Date.parse(line.expiryTime) : null,
    /* Google auto-refunds a purchase nobody acknowledged within three days.
     * This is the caller's cue to do it, and the most commonly missed step in
     * the whole of Play Billing. */
    needsAck: (p.acknowledgementState || '') === 'ACKNOWLEDGEMENT_STATE_PENDING',
  };
}

/** What we already believe about this install, without asking Google again. */
export async function entitlement(kv, install) {
  if (!install) return null;
  return kv.get(`ent:${await tag(install)}`, 'json');
}

export async function grant(kv, install, verdict) {
  const ttl = verdict.until
    /* Kept until the subscription lapses, and no longer — an entitlement that
     * outlives the payment is a free subscription with extra steps. Capped at a
     * day so a cancellation is never more than that far out of date. */
    ? Math.max(60, Math.min(86400, Math.floor((verdict.until - Date.now()) / 1000)))
    : 3600;
  await kv.put(`ent:${await tag(install)}`, JSON.stringify({
    active: verdict.active, until: verdict.until, product: verdict.product,
  }), { expirationTtl: ttl });
}

/* Is this plan allowed to use Google's chargers?
 *
 * Returns what happened rather than a bare yes, because the app shows the
 * remaining count and "you have none left" and "we could not tell" have to
 * read differently to whoever is looking at it. */
export async function allowPlan(env, install, planId) {
  if (!billing(env)) return { allowed: true, reason: 'billing off' };
  if (!install) return { allowed: true, reason: 'no install id — not counted' };

  const ent = await entitlement(env.CACHE, install);
  if (ent && ent.active) return { allowed: true, reason: 'subscribed', subscribed: true };

  const key = `pl:${await tag(install)}:${MONTH()}`;
  const used = parseInt(await env.CACHE.get(key) || '0', 10);
  const cap = freeAllowance(env);

  /* Every request of one planning run carries the same plan id, and only the
   * first is counted. Without this a 500 km corridor would spend six of a
   * fifteen-plan allowance on one drive. */
  if (planId) {
    const seen = `pd:${await tag(install)}:${planId}`;
    if (await env.CACHE.get(seen)) {
      return { allowed: used <= cap, reason: 'same plan', used, cap };
    }
    /* Two hours: longer than any planning run, short enough that the keys
     * expire on their own rather than accumulating one per plan forever. */
    await env.CACHE.put(seen, '1', { expirationTtl: 7200 });
  }

  if (used >= cap) return { allowed: false, reason: 'free plans used up', used, cap };

  await env.CACHE.put(key, String(used + 1), { expirationTtl: 40 * 86400 });
  return { allowed: true, reason: 'free plan', used: used + 1, cap };
}

/** What the app shows on the upgrade screen. */
export async function status(env, install) {
  if (!billing(env)) return { billing: 'off' };
  const ent = await entitlement(env.CACHE, install);
  if (ent && ent.active) {
    return { billing: 'on', subscribed: true, until: ent.until, product: ent.product };
  }
  const used = install
    ? parseInt(await env.CACHE.get(`pl:${await tag(install)}:${MONTH()}`) || '0', 10)
    : 0;
  const cap = freeAllowance(env);
  return {
    billing: 'on', subscribed: false, used, cap, left: Math.max(0, cap - used),
    product: env.BILLING_PRODUCT,
  };
}
