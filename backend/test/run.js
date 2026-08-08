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

const calls = { nearby: 0, place: 0, autocomplete: 0, text: 0, route: 0, resolve: 0 };
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
    return reply({ suggestions: [{ placePrediction: { placeId: 'x1', text: { text: 'Manali' } } }] });
  }
  if (u.includes(':searchText')) {
    calls.text++;
    return reply({ places: [{ displayName: { text: 'Manali' },
      location: { latitude: 32.2, longitude: 77.1 }, formattedAddress: 'HP' }] });
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
const call = (e, method, path, body) => worker.fetch(new Request(
  `https://api.test${path}`,
  {
    method,
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.0.0.${++ip % 250}` },
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
