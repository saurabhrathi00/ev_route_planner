#!/usr/bin/env node
/* The Worker, exercised without a network, a key, or a Cloudflare account.
 *
 *     npm test
 *
 * KV is a Map with expiry, `fetch` is a stub that answers with recorded Google
 * shapes and counts how many times it was called. That count is the point:
 * almost everything worth checking here is "did this go upstream, and how
 * often" — a cache that returns the right answer while quietly paying for it
 * every time looks identical from the outside.
 */
import worker from '../src/index.js';

let pass = 0, fail = 0;
const bad = [];
const check = (what, ok, detail = '') => {
  if (ok) { pass++; return; }
  fail++; bad.push(`${what}${detail ? ' — ' + detail : ''}`);
};

/* ---- a KV that expires ------------------------------------------------- */
function kv() {
  const m = new Map();
  return {
    async get(k, type) {
      const hit = m.get(k);
      if (!hit) return null;
      if (hit.until && hit.until < Date.now()) { m.delete(k); return null; }
      return type === 'json' ? JSON.parse(hit.v) : hit.v;
    },
    async put(k, v, opts = {}) {
      m.set(k, { v, until: opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : 0 });
    },
    async delete(k) {
      m.delete(k);
    },
    async list({ prefix = '', limit = 1000 } = {}) {
      return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).slice(0, limit).map(name => ({ name })) };
    },
    /** move every entry's clock forward, to test expiry without waiting */
    _age(seconds) {
      for (const [k, hit] of m) if (hit.until) hit.until -= seconds * 1000;
    },
    _size: () => m.size,
  };
}

/* ---- a Google that never was ------------------------------------------- */
const PLACE = (id, free) => ({
  id,
  displayName: { text: `Site ${id}` },
  location: { latitude: 30.1, longitude: 77.2 },
  rating: 4.2, userRatingCount: 60,
  formattedAddress: 'NH44',
  googleMapsUri: 'https://maps.google.com/?q=1',
  currentOpeningHours: { openNow: true },
  evChargeOptions: {
    connectorCount: 4,
    connectorAggregation: [
      { type: 'EV_CONNECTOR_TYPE_CCS_COMBO_2', count: 2, availableCount: free,
        outOfServiceCount: 1, maxChargeRateKw: 60,
        availabilityLastUpdateTime: '2026-08-08T09:00:00Z' },
      { type: 'EV_CONNECTOR_TYPE_TYPE_2', count: 2, availableCount: 2, maxChargeRateKw: 7.4 },
    ],
  },
});

/* A 2048-bit key generated once and pinned here. The service-account JWT is
   signed for real in WebCrypto, so this cannot be a placeholder string. */
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCUhx5/c5EXsPiL
5m3vPDH/hagxGry5JHptsHeG1bTd2jyBSa1O7iZkhmNlBLi+yuMlr1TPOzqs5RzX
LaHm3R3rbQxI5ncMIvRlw1fpVt47eonyJPRVfig4fHbdZnrp9dxIZjzR+lCAK5/c
TU3ECZ7atAzdEEN6bO/iZo07QkQlTJ9gD+9Fp/3tHyr0triApOXVk2PilOK8Htun
c5E36SrwiUMxDMVosQTUemqP4MsCFaDM9MtvhMz7WVe+S/uM6R835k4rQ7Jpyrpw
eYkFHPRBj381GldObt5DiB5kBtIgjWOC35P02uy3LUzel2BDabgaDXNqqIYleufw
wbEgYjIJAgMBAAECggEAPH6wUE78yL5+7VRkcG1/G8kPkTiHp40RBH48oMGIUlgi
DrK4kQ50urr13t5GdQdj7yRzkZhZNLR4w7fFWqezGQGoYETmNh5ClvQyaUrFZ0po
xySAFBY3QZKIQ3MLGyHVn/NsUEX45cte6DbgNrmIZyGwn5WRNlsKdZc5bOp3oQzu
Y53auYT3BhDy7t0FwFkNTzAF5ZYxxtLP2QyZgoBuJ2Um2yh971QOXtgSPmawkaUK
Ul6Aq+2W2LWgpGV1yle3gfyqUjtyDGBrpgbhXSPPKPNL11KYtnoAJiAMiQ8km/OF
V1P5IHPNn8Eq/PpRzqLQ/n7rS5xOLX8wee5LlhktFQKBgQDKitMwfisH24vhI9hR
8T4C/eBDfBZBqhZmf61U9ImOpsaZ/4yDwD5gDatgwAbhnsgLUq5URSs14NWQBbI7
Kgxd3jTSI6sVyUa3jmeGHflUCGFx3tTRXc356HhNnwmAB1U2THafHx6zczpdx0i4
TvOXz/JnY67iuoIYvj9R4Ig2wwKBgQC7urKtPA3tKxiT2NRONM1TafYxPEktfDa3
Rhhm1aYYN/ePUyGz2qn29+hzz78RbNb83A/dwE4S/b0W/JFUSJuxzpS9HKs0hgWq
VsqncBSm9U2npvs0sqhAZRKIauFH+schV0YSPra/LDH5l13b758vzdAvcKNJiY12
e9c0dljfQwKBgHc0K0VQDC1Mtk+kFA1uCQwjtNii8EpnO1XJ8Q6d+VN+rkY2U9G6
1Dsd8G45thMVqzCW0ckBCIRmNerUn2gYwDyCqd2/ZlKlKjyf0Cfr/jDJ2ef1uJUc
OzzI5/zvC91Q84LIj8voud3thD1rK05mERGZLlZRIb2I/UZoucWLez+XAoGAaDZr
C+njnT4oRaK/sK51MRIIfiqGQP7MbQ83apa9voILJoAynGINqjDS1L+FxMmTywjq
seIYNUiwWHtavdwUui8AuL6ad+zSZk4J78szW7+fHSuAFi/7YMv67snOR6P6ORL2
rhgsYJHLKFAT5Yzu5J2vLTatHpyCcDytKc1s5nsCgYBuo7emm+iWnMwYseoZqwWw
x8mCbNZ4fkVk5ssQQFPXX9dsniLt6cdkSN1SSwKH+wqxge+Rt66NQ+8Flk9ZiETc
cAPnl67ptncIT3jIPTGI9nw0ZID0T8QhS7AZhcl7JqoB2jy2eISWDp1ny9xPH3P+
dbzIfxq71JGK06hAJbEUXA==
-----END PRIVATE KEY-----`;

const calls = { nearby: 0, place: 0, autocomplete: 0, text: 0, route: 0, resolve: 0 };

/* A service account, shaped like the real thing. The private key is a real
   generated one — the code signs a JWT with it, so a fake string would fail in
   WebCrypto rather than in the logic being tested. */
const SA = { client_email: 'safar@test.iam.gserviceaccount.com', private_key: TEST_KEY };

/* What Google is currently willing to say about the caller. Each test sets this
   to the verdict it wants to see handled. */
let verdict = { package: 'com.evroute.app', recognition: 'PLAY_RECOGNIZED', hash: null };

/* What Google currently says about a purchase token. null is "no such
   purchase", which is what a made-up token gets. */
let purchase = null;
let nextFree = 1;
let upstreamStatus = 200;

globalThis.fetch = async (url, init) => {
  const u = String(url);
  const reply = (body, status = upstreamStatus) => ({
    ok: status < 400, status,
    json: async () => body,
  });
  if (u.includes(':searchNearby')) {
    calls.nearby++;
    return reply({ places: [PLACE('p1', nextFree), PLACE('p2', 0)] });
  }
  if (u.includes(':autocomplete')) {
    calls.autocomplete++;
    return reply({ suggestions: [{ placePrediction: {
      placeId: 'x1', text: { text: 'Manali, Himachal Pradesh' },
      structuredFormat: { mainText: { text: 'Manali' },
                          secondaryText: { text: 'Himachal Pradesh, India' } },
    } }] });
  }
  if (u.includes(':searchText')) {
    calls.text++;
    return reply({ places: [{ displayName: { text: 'Manali' },
      location: { latitude: 32.2, longitude: 77.1 }, formattedAddress: 'HP' }] });
  }
  if (u.includes('oauth2.googleapis.com/token')) {
    return reply({ access_token: 'stub-access-token', expires_in: 3600 });
  }
  if (u.includes('subscriptionsv2/tokens/')) {
    if (!purchase) return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
    return reply(purchase);
  }
  if (u.includes('decodeIntegrityToken')) {
    return reply({ tokenPayloadExternal: {
      requestDetails: { requestPackageName: verdict.package, requestHash: verdict.hash },
      appIntegrity: { appRecognitionVerdict: verdict.recognition, packageName: verdict.package },
      deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
    } });
  }
  if (u.includes('computeRoutes')) {
    calls.route++;
    /* The quiet-road call asks for the duration alone; the real one asks for the
       per-step shape the physics walks. Told apart by the mask, as Google does. */
    const mask = init && init.headers && init.headers['X-Goog-FieldMask'];
    if (mask === 'routes.duration') return reply({ routes: [{ duration: '30000s' }] });
    return reply({ routes: [{
      distanceMeters: 498000, duration: '32400s', staticDuration: '30000s',
      legs: [{ steps: [
        { polyline: { encodedPolyline: 'aaa' }, distanceMeters: 200000, staticDuration: '12000s' },
        { polyline: { encodedPolyline: 'bbb' }, distanceMeters: 298000, staticDuration: '18000s' },
      ] }],
    }] });
  }
  if (u.includes('/places/')) {
    const mask = init && init.headers && init.headers['X-Goog-FieldMask'];
    if (mask === 'location') {
      calls.resolve++;
      return reply({ location: { latitude: 32.2, longitude: 77.1 } });
    }
    calls.place++;
    return reply({ evChargeOptions: PLACE('p1', nextFree).evChargeOptions });
  }
  throw new Error('the worker asked for something the stub does not know: ' + u);
};

/* ---- driving it -------------------------------------------------------- */
const env = () => ({ GOOGLE_KEY: 'test-key', CACHE: kv(), TRIPS: kv() });

let ip = 0;
const call = (e, method, path, body, session) => worker.fetch(new Request(
  `https://api.test${path}`,
  {
    method,
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': `10.0.0.${++ip % 250}`,
      ...(session ? { Authorization: `Bearer ${session}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  },
), e);

const CIRCLE = { lat: 30.1234, lng: 77.2345, radiusKm: 45 };

async function main() {
  console.log('\n  safar-api');
  console.log('  ' + '-'.repeat(58));

  /* --- the shape of a charger --- */
  {
    const e = env();
    const r = await call(e, 'POST', '/nearby', CIRCLE);
    const { chargers } = await r.json();
    const c = chargers[0];
    console.log(`  a mixed site reads as ${c.points} DC bays, ${c.free} free, ${c.dead} out of service`);
    check('nearby answers', r.status === 200 && chargers.length === 2, `${r.status}`);
    check('AC sockets stay out of the bay count', c.points === 2, `${c.points}`);
    check('AC sockets stay out of the free count', c.free === 1, `${c.free}`);
    check('an out-of-service gun is counted', c.dead === 1, `${c.dead}`);
    check("google's own timestamp is kept", c.liveAt === Date.parse('2026-08-08T09:00:00Z'), `${c.liveAt}`);
    check('the place id comes through', c.pid === 'p1', `${c.pid}`);
  }

  /* --- the cache, which is the whole reason this exists --- */
  {
    const e = env();
    calls.nearby = 0;
    await call(e, 'POST', '/nearby', CIRCLE);
    await call(e, 'POST', '/nearby', CIRCLE);
    check('the same circle is fetched once', calls.nearby === 1, `${calls.nearby} calls`);

    /* Two drivers sample the same road a few hundred metres apart. Any grid has
       boundaries and some pairs will straddle one, so the claim worth making is
       not "always" but "nearly always" — the first version rounded finely
       enough that it was closer to a coin toss, and passed a test that only
       tried one pair. */
    let shared = 0;
    const base = (await import('../src/cache.js')).cell(CIRCLE.lat, CIRCLE.lng, CIRCLE.radiusKm);
    const cellOf = (await import('../src/cache.js')).cell;
    for (let i = 0; i < 60; i++) {
      const jitterLat = CIRCLE.lat + (i - 30) * 0.00005;      // ±165 m
      const jitterLng = CIRCLE.lng + (i - 30) * 0.00005;
      if (cellOf(jitterLat, jitterLng, CIRCLE.radiusKm) === base) shared++;
    }
    check('samples of one road nearly always share a cache entry',
      shared >= 54, `${shared} of 60`);
    console.log(`  60 samples along 330 m of road: ${shared} share one cache entry`);

    calls.nearby = 0;
    await call(e, 'POST', '/nearby', { lat: 28.6, lng: 77.2, radiusKm: 45 });
    check('a different road does not', calls.nearby === 1, `${calls.nearby} calls`);
  }

  /* --- availability expires on its own clock --- */
  {
    const e = env();
    await call(e, 'POST', '/nearby', CIRCLE);
    e.CACHE._age(20 * 60);                       // twenty minutes on
    const r = await call(e, 'POST', '/nearby', CIRCLE);
    const { chargers, cached } = await r.json();
    check('the circle is still cached after twenty minutes', cached === true);
    check('but its free-gun counts are not',
      chargers[0].free === null, `free ${chargers[0].free}`);
    console.log('  after 20 min: sites still cached, counts gone');

    e.CACHE._age(6 * 3600);                      // and six hours on
    calls.nearby = 0;
    await call(e, 'POST', '/nearby', CIRCLE);
    check('the circle itself expires at six hours', calls.nearby === 1, `${calls.nearby} calls`);
  }

  /* --- one charger, checked again --- */
  {
    const e = env();
    calls.place = 0;
    nextFree = 2;
    const r = await call(e, 'GET', '/place/p9');
    const av = await r.json();
    check('a single charger can be asked about', r.status === 200 && av.free === 2, `${av.free}`);
    check('and it costs one lookup', calls.place === 1, `${calls.place}`);
    await call(e, 'GET', '/place/p9');
    check('asked twice inside the window, it costs one', calls.place === 1, `${calls.place}`);
  }

  /* --- routes: the road keeps, the traffic does not --- */
  {
    const e = env();
    calls.route = 0;
    const from = { lat: 28.6, lng: 77.2 }, to = { lat: 32.2, lng: 77.1 };
    await call(e, 'POST', '/route', { from, to });
    await call(e, 'POST', '/route', { from, to });
    check('a road is fetched once', calls.route === 1, `${calls.route} calls`);
    await call(e, 'POST', '/route', { from, to, departAt: new Date(Date.now() + 3600e3).toISOString() });
    check('but a departure time always asks again', calls.route === 2, `${calls.route} calls`);

    /* The shape is the contract. The app's simulation walks the road step by
       step; a single overall polyline, which this returned at first, would have
       left the planner with nothing to walk. */
    const j = await (await call(e, 'POST', '/route', { from, to })).json();
    check('the road comes back step by step', j.steps.length === 2, JSON.stringify(j).slice(0, 120));
    check('each step carries its own shape, length and quiet time',
      j.steps.every(s2 => s2.polyline && s2.distance > 0 && s2.duration > 0), '');
    check('the step lengths add up to the whole',
      j.steps.reduce((n, s2) => n + s2.distance, 0) === j.distance, `${j.distance}`);
    check('durations are seconds, not "32400s"',
      j.seconds === 32400 && j.quietSeconds === 30000, `${j.seconds}/${j.quietSeconds}`);

    calls.route = 0;
    const q1 = await (await call(e, 'POST', '/quiet', { from, to })).json();
    await call(e, 'POST', '/quiet', { from, to });
    check('the 3am road is asked once and kept', q1.seconds === 30000 && calls.route === 1,
      `${q1.seconds}/${calls.route}`);
  }

  /* --- the budget fails soft --- */
  {
    const e = env();
    await call(e, 'POST', '/nearby', CIRCLE);          // fill the cache
    await e.CACHE.put('bg:' + new Date().toISOString().slice(0, 10) + ':nearby', '999999');
    calls.nearby = 0;
    const r = await call(e, 'POST', '/nearby', CIRCLE);
    const j = await r.json();
    check('past the budget it still answers', r.status === 200, `${r.status}`);
    check('from cache, without paying', calls.nearby === 0 && j.cached === true, `${calls.nearby}`);

    const r2 = await call(e, 'POST', '/nearby', { lat: 1.5, lng: 1.5, radiusKm: 40 });
    const j2 = await r2.json();
    check('and says so when it has nothing cached',
      r2.status === 200 && j2.degraded === true && j2.chargers.length === 0, JSON.stringify(j2));
    console.log('  past budget: cache still served, empty answers flagged degraded');
  }

  /* --- the search menu gets what it draws with --- */
  {
    const e = env();
    const j = await (await call(e, 'POST', '/autocomplete', { input: 'Manali' })).json();
    const [first] = j.places;
    /* `placeId`, not `id`. The app looks up the tapped suggestion by that name,
       and the first version of this returned `id` — so every suggestion in a
       proxied build looked fine and resolved to nothing. */
    check('a suggestion carries the id the app resolves by', first.placeId === 'x1',
      JSON.stringify(first));
    check('and is split into the bold line and the grey one',
      first.main === 'Manali' && /Himachal/.test(first.sec), JSON.stringify(first));
  }

  /* --- the door, when it is locked --- */
  {
    /* A service account and a session secret is what turns attestation on, so
       this env has both — and a stub Google, because the point being tested is
       what this service does with a verdict, not that Google can be reached. */
    const e = { ...env(), SERVICE_ACCOUNT: JSON.stringify(SA), SESSION_SECRET: 'test-secret' };

    const open = await (await call(e, 'GET', '/health')).json();
    check('health says the door is locked', open.attestation === 'required', open.attestation);

    const cold = await call(e, 'POST', '/nearby', CIRCLE);
    check('without a pass, nothing that costs money answers', cold.status === 401, `${cold.status}`);

    const { nonce } = await (await call(e, 'GET', '/auth/nonce')).json();
    check('a nonce is handed out', !!nonce, `${nonce}`);

    verdict = { package: 'com.evroute.app', recognition: 'PLAY_RECOGNIZED', hash: nonce };
    const ok = await (await call(e, 'POST', '/auth/verify', { token: 't', nonce })).json();
    check('the real app gets a session', !!ok.session, JSON.stringify(ok));

    const after = await call(e, 'POST', '/nearby', CIRCLE, ok.session);
    check('and with it, everything opens', after.status === 200, `${after.status}`);

    /* The clone: same package name, its own signing key — which is exactly what
       Google reports as UNRECOGNIZED_VERSION. */
    const { nonce: n2 } = await (await call(e, 'GET', '/auth/nonce')).json();
    verdict = { package: 'com.evroute.app', recognition: 'UNRECOGNIZED_VERSION', hash: n2 };
    const clone = await call(e, 'POST', '/auth/verify', { token: 't', nonce: n2 });
    check('a clone is refused', clone.status === 403, `${clone.status}`);

    /* A captured token, sent again. The nonce it answers is gone. */
    const { nonce: n3 } = await (await call(e, 'GET', '/auth/nonce')).json();
    verdict = { package: 'com.evroute.app', recognition: 'PLAY_RECOGNIZED', hash: n3 };
    await call(e, 'POST', '/auth/verify', { token: 't', nonce: n3 });
    const replay = await call(e, 'POST', '/auth/verify', { token: 't', nonce: n3 });
    check('a token cannot be replayed', replay.status === 403, `${replay.status}`);

    /* A token for a different question — captured from another handset. */
    const { nonce: n4 } = await (await call(e, 'GET', '/auth/nonce')).json();
    verdict = { package: 'com.evroute.app', recognition: 'PLAY_RECOGNIZED', hash: 'somebody-elses' };
    const wrong = await call(e, 'POST', '/auth/verify', { token: 't', nonce: n4 });
    check('a token bound to another nonce is refused', wrong.status === 403, `${wrong.status}`);

    /* And a session token somebody wrote themselves. */
    const forged = await call(e, 'POST', '/nearby', CIRCLE, `${Date.now() + 1e9}.x.notasignature`);
    check('a made-up session is refused', forged.status === 401, `${forged.status}`);

    console.log('  clone refused, replay refused, forged pass refused');
  }

  /* --- and when it is not configured, it says so rather than pretending --- */
  {
    const e = env();
    const h = await (await call(e, 'GET', '/health')).json();
    check('an unconfigured service admits the door is open', h.attestation === 'open', h.attestation);
    const r = await call(e, 'POST', '/nearby', CIRCLE);
    check('and still answers, as it did before any of this', r.status === 200, `${r.status}`);
  }

  /* --- free plans, and what happens after them --- */
  {
    const e = { ...env(), SERVICE_ACCOUNT: JSON.stringify(SA), BILLING_PRODUCT: 'safar_plus',
                FREE_PLANS: '3' };
    const me = { install: 'install-abc' };

    const h = await (await call(e, 'GET', '/health')).json();
    check('health says billing is on', /^on, 3 free plans/.test(h.billing), h.billing);

    /* One planning run is many charger calls. All of them carry the same plan
       id, and the allowance must move by one. */
    for (let i = 0; i < 6; i++) {
      await call(e, 'POST', '/nearby', { ...CIRCLE, ...me, plan: 'plan-1' });
    }
    let st = await (await call(e, 'POST', '/billing/status', me)).json();
    check('a plan of six lookups costs one free plan', st.used === 1, JSON.stringify(st));

    await call(e, 'POST', '/nearby', { ...CIRCLE, ...me, plan: 'plan-2' });
    await call(e, 'POST', '/nearby', { ...CIRCLE, ...me, plan: 'plan-3' });
    st = await (await call(e, 'POST', '/billing/status', me)).json();
    check('three plans use the three that are free', st.used === 3 && st.left === 0,
      JSON.stringify(st));

    /* And the fourth. Not an error, not an empty road — the same `degraded`
       the daily budget uses, which the app already turns into Open Charge Map
       and OpenStreetMap. */
    const over = await (await call(e, 'POST', '/nearby', { ...CIRCLE, ...me, plan: 'plan-4' })).json();
    check('the fourth falls back instead of failing',
      over.degraded === true && over.chargers.length === 0, JSON.stringify(over).slice(0, 140));
    check('and says why, so the app can offer the upgrade',
      /free plans used up/.test(over.reason || ''), over.reason);

    /* Somebody else's phone is somebody else's allowance. */
    const other = await (await call(e, 'POST', '/billing/status', { install: 'install-xyz' })).json();
    check('another install starts fresh', other.used === 0 && other.left === 3, JSON.stringify(other));

    /* Subscribing lifts it. */
    purchase = {
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
      lineItems: [{ productId: 'safar_plus', expiryTime: new Date(Date.now() + 30 * 86400e3).toISOString() }],
    };
    const v = await (await call(e, 'POST', '/billing/verify', { ...me, token: 'purchase-token' })).json();
    check('a real purchase verifies', v.active === true, JSON.stringify(v));
    check('and it says the purchase still needs acknowledging', v.needsAck === true,
      'three days later Google refunds it');

    const after = await (await call(e, 'POST', '/nearby', { ...CIRCLE, ...me, plan: 'plan-5' })).json();
    check('a subscriber is past the wall', after.degraded !== true, JSON.stringify(after).slice(0, 120));
    st = await (await call(e, 'POST', '/billing/status', me)).json();
    check('and the screen says subscribed rather than counting', st.subscribed === true,
      JSON.stringify(st));

    /* A token nobody bought. */
    purchase = null;
    const fake = await call(e, 'POST', '/billing/verify', { ...me, token: 'made-up' });
    check('an invented purchase token is refused', fake.status === 404, `${fake.status}`);

    console.log(`  3 free plans, 6 lookups each; the fourth degrades to the open sources`);
  }

  /* --- with billing off, none of it exists --- */
  {
    const e = env();
    const st = await (await call(e, 'POST', '/billing/status', { install: 'i' })).json();
    check('billing off means no upgrade screen at all', st.billing === 'off', JSON.stringify(st));
    for (let i = 0; i < 40; i++) {
      await call(e, 'POST', '/nearby', { ...CIRCLE, install: 'i', plan: `p${i}` });
    }
    const r = await (await call(e, 'POST', '/nearby', { ...CIRCLE, install: 'i', plan: 'p99' })).json();
    check('and forty plans cost nothing', r.degraded !== true, JSON.stringify(r).slice(0, 100));
  }

  /* --- the soft cap has to be the one that fires first --- */
  {
    /* Shipped at 8000 against a Cloud Console quota of 220, which meant the
       Worker's cap could never be reached and Google's always was — the hard
       failure every time, the soft one never. The caps are settable now, and
       what matters is that a set one is honoured. */
    const e = { ...env(), BUDGETS: JSON.stringify({ nearby: 2 }) };
    const h = await (await call(e, 'GET', '/health')).json();
    check('a cap set in the environment is the cap', h.budget.nearby.cap === 2,
      `${h.budget.nearby.cap}`);
    check('and the others keep their defaults', h.budget.route.cap === 300,
      `${h.budget.route.cap}`);

    await call(e, 'POST', '/nearby', { lat: 10, lng: 10, radiusKm: 40 });
    await call(e, 'POST', '/nearby', { lat: 20, lng: 20, radiusKm: 40 });
    const third = await (await call(e, 'POST', '/nearby', { lat: 30, lng: 30, radiusKm: 40 })).json();
    check('past it, the service degrades rather than errors',
      third.degraded === true && third.chargers.length === 0, JSON.stringify(third).slice(0, 100));

    /* Nonsense in the variable must not silently mean "no cap at all". */
    const broken = { ...env(), BUDGETS: 'not json' };
    const hb = await (await call(broken, 'GET', '/health')).json();
    check('a malformed budget falls back to the defaults, not to none',
      hb.budget.nearby.cap === 200, `${hb.budget.nearby.cap}`);
  }

  /* --- the rate limiter counts without recording who --- */
  {
    const e = env();
    for (let i = 0; i < 3; i++) await call(e, 'POST', '/text', { query: 'Manali' });
    const keys = (await e.CACHE.list({ prefix: 'rl:' })).keys.map(k => k.name);
    check('the limiter kept a counter', keys.length > 0, `${keys.length}`);
    /* call() sends CF-Connecting-IP: 10.0.0.<n>, so this is the real address
       these counters were made from — and none of it may appear in the key. */
    check('but no address is in it', !keys.some(k => /10\.0\.0\./.test(k)), keys.join(' '));
    console.log(`  rate key: ${keys[0]}`);
  }

  /* --- what it refuses --- */
  {
    const e = env();
    const cases = [
      ['a coordinate that is a word', 'POST', '/nearby', { lat: 'north', lng: 77, radiusKm: 40 }, 400],
      ['a radius of a thousand km', 'POST', '/nearby', { lat: 30, lng: 77, radiusKm: 1000 }, 400],
      ['an empty search', 'POST', '/text', { query: '   ' }, 400],
      ['an endpoint that does not exist', 'GET', '/../etc/passwd', null, 404],
      ['a url someone hoped it would fetch', 'POST', '/fetch', { url: 'http://169.254.169.254/' }, 404],
    ];
    for (const [what, m, p, b, want] of cases) {
      const r = await call(e, m, p, b);
      check(`it refuses ${what}`, r.status === want, `got ${r.status}, wanted ${want}`);
    }
    const leak = await (await call(e, 'POST', '/nearby', { lat: 'x', lng: 1, radiusKm: 1 })).json();
    check('and its errors carry nothing from upstream',
      !/project|quota|api key|googleapis/i.test(JSON.stringify(leak)), JSON.stringify(leak));
  }

  /* --- upstream having a bad day --- */
  {
    const e = env();
    upstreamStatus = 403;
    const r = await call(e, 'POST', '/nearby', { lat: 12.9, lng: 77.6, radiusKm: 40 });
    const j = await r.json();
    check('an upstream refusal is not passed through as-is', r.status === 502, `${r.status}`);
    check('and says nothing about why Google minded',
      !/403|project|quota/i.test(JSON.stringify(j)), JSON.stringify(j));
    upstreamStatus = 200;
  }

  /* --- rate limiting --- */
  {
    const e = env();
    let limited = 0;
    for (let i = 0; i < 60; i++) {
      const r = await worker.fetch(new Request('https://api.test/nearby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
        body: JSON.stringify(CIRCLE),
      }), e);
      if (r.status === 429) limited++;
    }
    check('one address hammering it gets cut off', limited > 0, 'never limited');
    console.log(`  60 requests from one address: ${limited} refused`);
  }

  /* --- the drive log --- */
  {
    const e = env();
    const good = { car: 'curvv55', km: 498, climb: 2410, tempC: 24,
                   predictedPct: 94.2, actualPct: 99.1, kmh: 62, build: '4.4' };
    const r = await call(e, 'POST', '/trip', good);
    check('a drive can be logged', r.status === 201, `${r.status}`);

    const stored = await e.TRIPS.get((await e.TRIPS.list({ prefix: 'trip:' })).keys[0].name, 'json');
    check('and it carries no identity',
      !('from' in stored) && !('to' in stored) && !('lat' in stored) && !('id' in stored),
      Object.keys(stored).join(','));

    for (const bad_ of [
      { ...good, car: '../../etc' },
      { ...good, km: 99999 },
      { ...good, actualPct: -5 },
      { ...good, tempC: 900 },
    ]) {
      const rr = await call(e, 'POST', '/trip', bad_);
      check('a nonsense drive is refused', rr.status === 400, `${rr.status}`);
    }

    await call(e, 'POST', '/trip', { ...good, actualPct: 105.4 });
    const sum = await (await call(e, 'GET', '/trips')).json();
    check('the pool can be summarised', sum.trips === 2 && sum.cars === 1, JSON.stringify(sum));
    console.log(`  ${sum.trips} drives pooled, median error ${sum.medianError}%`);
  }

  /* --- health and config --- */
  {
    const e = env();
    const h = await (await call(e, 'GET', '/health')).json();
    check('health reports the key is set', h.ok && h.upstream === 'configured', JSON.stringify(h));
    const c = await (await call(e, 'GET', '/config')).json();
    check('config admits the maps key stays on the device',
      c.mapsKeyIsClientSide === true, JSON.stringify(c));

    const naked = { CACHE: kv(), TRIPS: kv() };
    const r = await call(naked, 'POST', '/nearby', CIRCLE);
    check('without a key it refuses rather than pretending', r.status === 503, `${r.status}`);
    const hh = await (await call(naked, 'GET', '/health')).json();
    check('and health says which one is missing',
      /MISSING/.test(hh.upstream), hh.upstream);
  }

  console.log('  ' + '-'.repeat(58));
  console.log(`  ${pass} passed, ${fail} failed\n`);
  if (bad.length) { bad.forEach(b => console.log('  FAIL ' + b)); console.log(); }
  process.exit(fail ? 1 : 0);
}

main();
