/* The router.
 *
 * Nothing here takes a URL from the client. Every route names its own upstream,
 * so this is a service with five things it can do rather than a proxy that will
 * fetch whatever it is pointed at — which is the difference between moving the
 * key somewhere safer and putting an open relay on the internet.
 */

import * as G from './google.js';
import * as C from './cache.js';
import * as L from './limits.js';
import * as T from './trips.js';
import * as A from './attest.js';
import * as B from './billing.js';

const VERSION = '1.0.0';

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      /* The app runs from file:// in a WebView, which sends Origin: null, and
       * from a page on the web build. Both need to be allowed, and there is
       * nothing to protect with an origin check anyway — the service holds no
       * user data and every response is public information. */
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...extra,
    },
  });

const fail = e => json({ error: e.message || 'something went wrong' }, e.status || 500);

async function body(req) {
  const raw = await req.text();
  if (raw.length > 8192) { const e = new Error('body too large'); e.status = 413; throw e; }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { const e = new Error('body is not json'); e.status = 400; throw e; }
}

/* One upstream call, if the day's budget allows it. Past the ceiling this
 * returns null rather than throwing, so every caller has to decide what to do
 * without Google — and every one of them can answer from cache. */
async function upstream(env, sku, fn) {
  if (!await L.budgetLeft(env.CACHE, sku)) {
    console.warn(`budget spent: ${sku}`);
    return null;
  }
  await L.spend(env.CACHE, sku);
  return fn();
}

/* Attestation turns itself on when it is configured, and not before.
 *
 * The alternative is a flag, and a flag that says "check the caller" while the
 * credentials to check with are missing is a service that refuses everybody —
 * or, set the other way by someone in a hurry, one that lets everybody in while
 * claiming not to. Deriving it from the credentials makes those two states
 * impossible: with a service account it is enforced, without one it is honestly
 * reported as open. */
const attesting = env => !!(env.SERVICE_ACCOUNT && env.SESSION_SECRET);

/* The endpoints that spend money. /health and /config say nothing worth
   stealing, and the nonce has to be reachable before anyone has a session. */
const OPEN = new Set(['/health', '/config', '/auth/nonce', '/auth/verify']);

const ROUTES = {
  'GET /health': async (req, env) => json({
    ok: true,
    version: VERSION,
    upstream: env.GOOGLE_KEY ? 'configured' : 'MISSING GOOGLE_KEY',
    /* Whether the door is locked, in plain sight. Not a secret — a clone finds
       out by being refused — and the one thing worth being able to check from
       outside, because an attestation that quietly stopped being enforced looks
       exactly like one that works. */
    attestation: attesting(env) ? 'required' : 'open',
    billing: B.billing(env) ? `on, ${B.freeAllowance(env)} free plans a month` : 'off',
    budget: await L.spentToday(env.CACHE),
  }),

  /* A number to answer, good for two minutes and one use. */
  'GET /auth/nonce': async (req, env) => json(await A.newNonce(env.CACHE)),

  /* Google's statement about which app is running, exchanged for a day pass. */
  'POST /auth/verify': async (req, env) => {
    const b = await body(req);
    if (!attesting(env)) return json({ session: 'open', expiresIn: 86400, attestation: 'open' });
    return json(await A.verify(env, b.token, b.nonce));
  },

  /* What the client may rely on. The app asks once at start-up so that cache
   * ages and limits live in one place rather than being guessed at twice. */
  'GET /config': async (req, env) => json({
    version: VERSION,
    siteTtl: C.SITE_TTL,
    availabilityTtl: C.AVAIL_TTL,
    maxRadiusKm: 50,
    /* The map still needs its own key in the browser: the JavaScript library
     * runs on the device and talks to Google itself, so proxying the script tag
     * would hide nothing. That key is restricted to the Maps JavaScript API and
     * can do nothing else. */
    mapsKeyIsClientSide: true,
    /* Whether the app should carry an install id at all. It is the only
       per-device thing this service ever sees, and there is no reason to hold
       one while there is nothing to count — so the app asks first and creates
       it only if the answer is yes. */
    billing: B.billing(env) ? 'on' : 'off',
    freePlans: B.billing(env) ? B.freeAllowance(env) : null,
  }),

  'POST /nearby': async (req, env) => {
    const b = await body(req);
    const centre = L.coord(b, 'centre');
    const r = L.radius(b.radiusKm);
    const key = C.cell(centre.lat, centre.lng, r);

    /* Free plans are counted before the cache is consulted, deliberately. A
       cached answer is still Google's data, and letting popular corridors be
       free while quiet ones are not would make the allowance depend on which
       road somebody drives — impossible to explain and unfair to exactly the
       people this app is for. */
    const gate = await B.allowPlan(env, b.install, b.plan);
    if (!gate.allowed) {
      /* The same shape the daily budget uses, so the app's existing fallback
         to Open Charge Map and OpenStreetMap handles it with no new code:
         chargers still appear, without ratings or live bay counts. */
      return json({ chargers: [], degraded: true, reason: 'free plans used up',
                    used: gate.used, cap: gate.cap });
    }

    const hit = await C.readCircle(env.CACHE, key);
    if (hit) return json({ chargers: hit.sites, cached: true, at: hit.at, quota: gate });

    const fresh = await upstream(env, 'nearby',
      () => G.nearby(env.GOOGLE_KEY, centre, r));
    if (!fresh) return json({ chargers: [], cached: false, degraded: true });

    await C.writeCircle(env.CACHE, key, fresh);
    return json({ chargers: fresh, cached: false, at: Date.now(), quota: gate });
  },

  /* One charger, asked about again — the app's "check now". Availability has
   * its own short life, so this is usually a cache miss and a cheap single
   * lookup rather than a corridor swept twice. */
  'GET /place': async (req, env, url) => {
    const id = url.pathname.split('/')[2];
    if (!id) { const e = new Error('no place id'); e.status = 400; throw e; }

    const cached = await C.readAvailability(env.CACHE, id);
    if (cached) return json({ ...cached, cached: true });

    const ev = await upstream(env, 'place', () => G.placeEV(env.GOOGLE_KEY, id));
    if (!ev) { const e = new Error('busy — try again shortly'); e.status = 503; throw e; }
    await C.writeAvailability(env.CACHE, id, ev);
    return json({ ...ev, cached: false });
  },

  'POST /autocomplete': async (req, env) => {
    const b = await body(req);
    const input = L.text(b.input, 'input');
    const bias = b.lat != null ? L.coord(b, 'bias') : null;
    const out = await upstream(env, 'autocomplete',
      () => G.autocomplete(env.GOOGLE_KEY, input, b.sessionToken, bias));
    return json({ places: out || [], degraded: !out });
  },

  /* The coordinates behind a tapped suggestion. Sharing the session token with
   * the autocomplete above is what makes the pair bill as one lookup. */
  'POST /resolve': async (req, env) => {
    const b = await body(req);
    const id = L.text(b.id, 'id', 300);
    const loc = await upstream(env, 'place',
      () => G.placeLocation(env.GOOGLE_KEY, id, b.sessionToken));
    if (!loc) { const e = new Error('busy — try again shortly'); e.status = 503; throw e; }
    return json(loc);
  },

  'POST /text': async (req, env) => {
    const b = await body(req);
    const q = L.text(b.query, 'query');
    const bias = b.lat != null ? L.coord(b, 'bias') : null;
    const out = await upstream(env, 'text',
      () => G.searchText(env.GOOGLE_KEY, q, bias));
    return json({ places: out || [], degraded: !out });
  },

  'POST /route': async (req, env) => {
    const b = await body(req);
    const from = L.coord(b.from, 'from');
    const to = L.coord(b.to, 'to');

    /* Only the traffic-free road is cached. It does not move; the traffic
     * estimate is the whole reason a departure time was given, and caching that
     * would answer a question about Tuesday with an answer about Sunday. */
    const key = C.routeKey(from, to);
    if (!b.departAt) {
      const hit = await env.CACHE.get(key, 'json');
      if (hit) return json({ ...hit, cached: true });
    }

    const out = await upstream(env, 'route',
      () => G.route(env.GOOGLE_KEY, from, to, b.departAt));
    if (!out) { const e = new Error('busy — try again shortly'); e.status = 503; throw e; }

    if (!b.departAt) {
      await env.CACHE.put(key, JSON.stringify(out), { expirationTtl: C.ROUTE_TTL });
    }
    return json({ ...out, cached: false });
  },

  /* The 3am drive time, the divisor in the traffic ratio. Cached for a day
     because the empty road at 3am is the empty road at 3am. */
  'POST /quiet': async (req, env) => {
    const b = await body(req);
    const from = L.coord(b.from, 'from');
    const to = L.coord(b.to, 'to');
    const key = 'q' + C.routeKey(from, to);
    const hit = await env.CACHE.get(key, 'json');
    if (hit) return json({ ...hit, cached: true });

    const when = b.whenISO || new Date(Date.now() + 86400e3).toISOString();
    const seconds = await upstream(env, 'route',
      () => G.quietDuration(env.GOOGLE_KEY, from, to, when));
    if (seconds == null) return json({ seconds: null, degraded: true });
    await env.CACHE.put(key, JSON.stringify({ seconds }), { expirationTtl: 86400 });
    return json({ seconds, cached: false });
  },

  /* What the upgrade screen shows: subscribed, or how many free plans are left.
     Answers `{billing:'off'}` while this is switched off, which is the app's
     cue to show no upgrade screen at all rather than an empty one. */
  'POST /billing/status': async (req, env) => {
    const b = await body(req);
    return json(await B.status(env, b.install));
  },

  /* A purchase token from Play, checked with Google and remembered. The app
     sends this after a purchase and again on every start, because a
     subscription can lapse between one launch and the next. */
  'POST /billing/verify': async (req, env) => {
    const b = await body(req);
    if (!B.billing(env)) return json({ billing: 'off' });
    const token = L.text(b.token, 'token', 2000);
    const verdict = await B.checkPurchase(env, token, A.googleToken);
    await B.grant(env.CACHE, L.text(b.install, 'install', 100), verdict);
    return json(verdict);
  },

  /* The drive log, pooled. No identity, no route, no coordinates — see
   * trips.js for why those are missing rather than forgotten. */
  'POST /trip': async (req, env) => {
    const trip = T.readTrip(await body(req));
    const id = await T.store(env.TRIPS, trip);
    return json({ ok: true, id }, 201);
  },

  'GET /trips': async (req, env) => json(await T.summary(env.TRIPS)),
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    /* /place/{id} is the only route with a variable in it. Matching on the
     * first segment keeps the table above literal, which is what makes it
     * possible to read the whole surface of this service in one screen. */
    const first = '/' + url.pathname.split('/')[1];
    const handler = ROUTES[`${req.method} ${url.pathname}`] || ROUTES[`${req.method} ${first}`];
    if (!handler) return json({ error: 'no such endpoint' }, 404);

    try {
      if (url.pathname !== '/health') {
        const ip = req.headers.get('CF-Connecting-IP');
        if (await L.rateLimited(env.CACHE, ip)) {
          return json({ error: 'too many requests' }, 429, { 'Retry-After': '60' });
        }
      }
      if (!env.GOOGLE_KEY && url.pathname !== '/health' && url.pathname !== '/config') {
        return json({ error: 'not configured' }, 503);
      }
      if (attesting(env) && !OPEN.has(url.pathname)) {
        const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
        if (!await A.validSession(env.SESSION_SECRET, bearer)) {
          /* 401 rather than 403: the app's answer is to attest again, and a
             session that simply aged out overnight is the common case, not an
             attack. The app falls back to the open charger sources meanwhile,
             so a driver whose pass expired mid-journey still gets a plan. */
          return json({ error: 'attest first' }, 401);
        }
      }
      return await handler(req, env, url);
    } catch (e) {
      if (!e.status || e.status >= 500) console.error(url.pathname, e && e.stack);
      return fail(e);
    }
  },
};
