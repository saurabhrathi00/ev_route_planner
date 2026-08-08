/* Rate limiting and the daily budget.
 *
 * Moving the key here does not remove the problem it had, it relocates it. The
 * Worker is now the thing worth attacking, and it will hand out Google calls to
 * anyone who asks. None of this authenticates anybody — there are no accounts —
 * it exists to make the service uninteresting rather than impregnable.
 *
 * The budget is the part that matters. A cap that simply refuses past its
 * ceiling is the same outage the bundled key had, wearing a different hat. This
 * one refuses *upstream* and keeps serving the cache, so a bad day degrades to
 * chargers that are a few hours old rather than to an app that does not work.
 */

/** Requests per IP per window. Generous: a 500 km plan is about seven calls. */
const RATE = { window: 60, max: 40 };

/* Upstream calls per day, per SKU.
 *
 * These have to sit BELOW the daily quota set in Cloud Console, and that is the
 * whole reason they exist. Both stop the bill; only this one fails softly. Past
 * the Cloud quota Google returns an error for every call, which the app shows
 * as a lookup that broke; past this one the Worker keeps serving its cache and
 * only stops asking Google, which a driver never sees.
 *
 * Shipped at 8000 against a Cloud quota of 220 — which meant the soft one could
 * never fire and the hard one always did, exactly backwards. Overridable from
 * the environment now, so the two can be kept in step without a deploy each
 * time the Cloud quota moves. */
const DEFAULT_BUDGET = { nearby: 200, place: 200, autocomplete: 400, text: 100, route: 300 };

const budgetFor = (env, sku) => {
  const set = env && env.BUDGETS;
  if (set) {
    try {
      const n = JSON.parse(set)[sku];
      if (isFinite(n) && n > 0) return n;
    } catch { /* malformed: fall through to the defaults rather than to no cap */ }
  }
  return DEFAULT_BUDGET[sku];
};

export const budgets = env =>
  Object.fromEntries(Object.keys(DEFAULT_BUDGET).map(k => [k, budgetFor(env, k)]));

const today = () => new Date().toISOString().slice(0, 10);

/* The counter is keyed on a hash of the address, not the address.
 *
 * Counting requests needs to tell two callers apart; it does not need to know
 * who either of them is, and those are different requirements. A raw IP sitting
 * in KV — even for two minutes — is a record of who used the app and when, kept
 * for no reason beyond it being the obvious key to type. The hash counts just
 * as well and cannot be read backwards into an address.
 *
 * The bucket number is salted in, so the same address hashes differently each
 * minute and the entries cannot be lined up into a trail either. */
async function fingerprint(ip, bucket) {
  const bytes = new TextEncoder().encode(`${bucket}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest).slice(0, 8)]
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function rateLimited(kv, ip) {
  if (!ip) return false;
  const bucket = Math.floor(Date.now() / 1000 / RATE.window);
  const key = `rl:${await fingerprint(ip, bucket)}:${bucket}`;
  const n = parseInt(await kv.get(key) || '0', 10) + 1;
  /* Written back with a life of two windows: KV has no atomic increment, so a
   * burst can undercount, and the fix for that is a Durable Object rather than
   * a cleverer key. Undercounting a burst is acceptable; the budget below is
   * the backstop that is not allowed to be wrong. */
  await kv.put(key, String(n), { expirationTtl: RATE.window * 2 });
  return n > RATE.max;
}

export async function budgetLeft(kv, sku, env) {
  const cap = budgetFor(env, sku);
  if (!cap) return true;
  const n = parseInt(await kv.get(`bg:${today()}:${sku}`) || '0', 10);
  return n < cap;
}

export async function spend(kv, sku, env) {
  const key = `bg:${today()}:${sku}`;
  const n = parseInt(await kv.get(key) || '0', 10) + 1;
  await kv.put(key, String(n), { expirationTtl: 36 * 3600 });
  if (n === budgetFor(env, sku)) console.warn(`budget: ${sku} reached ${n} — serving cache only`);
  return n;
}

export async function spentToday(kv, env) {
  const caps = budgets(env);
  const out = {};
  for (const sku of Object.keys(caps)) {
    out[sku] = {
      spent: parseInt(await kv.get(`bg:${today()}:${sku}`) || '0', 10),
      cap: caps[sku],
    };
  }
  return out;
}

/* Shape checks, before anything is forwarded. A coordinate that is a string, a
 * radius of ten thousand kilometres, or a megabyte of "input" are all cheaper
 * to refuse here than to have Google refuse. */
export function coord(v, name) {
  const lat = Number(v && v.lat), lng = Number(v && v.lng);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    const e = new Error(`${name} is not a coordinate`);
    e.status = 400;
    throw e;
  }
  return { lat, lng };
}

export function text(v, name, max = 200) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > max) {
    const e = new Error(`${name} must be 1 to ${max} characters`);
    e.status = 400;
    throw e;
  }
  return s;
}

export function radius(v) {
  const r = Number(v);
  if (!isFinite(r) || r <= 0 || r > 50) {
    const e = new Error('radiusKm must be between 0 and 50');
    e.status = 400;
    throw e;
  }
  return r;
}
