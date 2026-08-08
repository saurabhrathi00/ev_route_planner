/* The deployed Worker, asked real questions.
 *
 * test/run.js proves the logic with Google stubbed out. This proves the other
 * half — that the key works, that the field masks are accepted, and that the
 * cache actually saves a call — and it can only be run against something live.
 * It spends real quota, a handful of calls, which is the point.
 *
 *   node test/smoke.js https://safar-api.safar-app.workers.dev
 */
const BASE = process.argv[2] || 'https://safar-api.safar-app.workers.dev';
let pass = 0, fail = 0;
const check = (what, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : 'FAIL'} ${what}${ok || !detail ? '' : ' — ' + detail}`);
  ok ? pass++ : fail++;
};

const call = async (path, body) => {
  const t0 = Date.now();
  const r = await fetch(BASE + path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : {});
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j, ms: Date.now() - t0 };
};

/* Two points on a road somebody actually drives, and a corridor circle on it. */
const DELHI = { lat: 28.6139, lng: 77.2090 };
const MANALI = { lat: 32.2396, lng: 77.1887 };
const CIRCLE = { lat: 30.7333, lng: 76.7794, radiusKm: 40 };   // Chandigarh, on the way

(async () => {
  console.log(`\n  ${BASE}\n  ${'-'.repeat(56)}`);

  const h = await call('/health');
  check('health answers', h.status === 200 && h.j.ok, JSON.stringify(h.j));
  check('the key is loaded', h.j.upstream === 'configured', h.j.upstream);
  if (h.j.upstream !== 'configured') {
    console.log('\n  No key — nothing else can be tested. wrangler secret put GOOGLE_KEY\n');
    process.exit(1);
  }

  const n1 = await call('/nearby', CIRCLE);
  check('chargers come back', n1.status === 200 && n1.j.chargers.length > 0,
    `${n1.status} ${JSON.stringify(n1.j).slice(0, 160)}`);
  const sites = n1.j.chargers || [];
  /* Not "every site is DC" — that was this test's mistake, and it says more
     about the test than the service. Google types a lot of places as charging
     stations and reports nothing about their guns, and the Worker passes on
     what it was told rather than inventing a verdict. The app is where the
     filtering belongs; it plans on `dc` and shows the rest as "AC only".
     What must hold is narrower: nothing is *labelled* DC that isn't. */
  const dc = sites.filter(c => c.dc);
  check('nothing is labelled DC that is not',
    dc.every(c => c.kw >= 25 || c.plugs.some(p => /CCS|CHAdeMO|Tesla/i.test(p))),
    JSON.stringify(dc.filter(c => c.kw < 25).slice(0, 2)));
  check('and the sweep found DC chargers at all', dc.length > 0, `${dc.length} of ${sites.length}`);
  const live = sites.filter(c => c.free != null);
  /* Only meaningful on a fresh sweep. A cached circle is six hours old while
     its bay counts live fifteen minutes, so an hour later the sites come back
     with `free: null` — not "all busy", but "nobody has asked recently", which
     is exactly the split this cache was built for. Asserting on a cached answer
     would be asserting about the time of day. */
  if (n1.j.cached) console.log(`     (cached circle — bay counts expire separately, ${live.length} still live)`);
  else check('at least one reports live free bays', live.length > 0,
    `${live.length} of ${sites.length} — Google has no counts for this area if 0`);
  console.log(`     ${sites.length} sites, ${dc.length} DC, ${live.length} with live counts, ${n1.ms} ms`);

  const n2 = await call('/nearby', CIRCLE);
  check('asked again, it comes from cache', n2.j.cached === true, JSON.stringify(n2.j).slice(0, 120));
  check('and cache is faster than Google', n2.ms < n1.ms, `${n2.ms} ms vs ${n1.ms} ms`);

  /* The point of the shared cache: a *different* driver, a few hundred metres
     along the same road, must land on the same entry. */
  const nearby = { lat: CIRCLE.lat + 0.002, lng: CIRCLE.lng - 0.001, radiusKm: 40 };
  let n3 = await call('/nearby', nearby);
  /* One retry, because KV is eventually consistent: a key that was read while
     it did not exist stays "missing" at that edge for up to a minute, so the
     very first write to a cell can be followed by a miss. It costs one wasted
     Google call and never a wrong answer, and only ever happens once per cell.
     A test that failed on it would be testing the weather. */
  if (n3.j.cached !== true) { await new Promise(r => setTimeout(r, 5000)); n3 = await call('/nearby', nearby); }
  check('another driver on the same road pays nothing', n3.j.cached === true,
    JSON.stringify(n3.j).slice(0, 120));

  const withPid = sites.find(c => c.pid);
  if (withPid) {
    const p = await call('/place/' + withPid.pid);
    check('one charger can be re-checked', p.status === 200 && 'free' in p.j,
      `${p.status} ${JSON.stringify(p.j).slice(0, 120)}`);
  }

  const a = await call('/autocomplete', { input: 'Manali', lat: 28.6, lng: 77.2 });
  check('place search works', a.status === 200 && a.j.places.length > 0,
    JSON.stringify(a.j).slice(0, 160));
  check('and a suggestion is shaped the way the menu draws it',
    a.j.places[0] && a.j.places[0].placeId && a.j.places[0].main,
    JSON.stringify(a.j.places[0]));
  if (a.j.places && a.j.places[0]) {
    /* placeId, the name the app looks it up by. This said `id` and passed
       against a service that also said `id` — two halves of one mistake
       agreeing with each other. */
    const res = await call('/resolve', { id: a.j.places[0].placeId });
    check('a suggestion resolves to coordinates',
      res.status === 200 && Math.abs(res.j.lat) > 0, JSON.stringify(res.j).slice(0, 120));
  }

  const r1 = await call('/route', { from: DELHI, to: MANALI });
  check('a route comes back', r1.status === 200 && r1.j.steps && r1.j.steps.length > 0,
    `${r1.status} ${JSON.stringify(r1.j).slice(0, 160)}`);
  if (r1.j.steps) {
    check('cut into steps the simulation can walk', r1.j.steps.length > 50, `${r1.j.steps.length} steps`);
    check('every step has a shape, a length and a quiet time',
      r1.j.steps.every(s => s.polyline && s.distance >= 0 && s.duration >= 0), '');
    const sum = r1.j.steps.reduce((n, s) => n + s.distance, 0);
    check('the steps add up to the whole road',
      Math.abs(sum - r1.j.distance) < r1.j.distance * 0.01,
      `${(sum / 1000).toFixed(1)} km of steps vs ${(r1.j.distance / 1000).toFixed(1)} km total`);
    /* Delhi-Manali is about 530 km and 12 hours. Wildly outside that means the
       road came back for two different points than the ones asked about. */
    const km = r1.j.distance / 1000, hrs = r1.j.seconds / 3600;
    check('and it is the right road', km > 400 && km < 700 && hrs > 8 && hrs < 20,
      `${km.toFixed(0)} km in ${hrs.toFixed(1)} h`);
  }

  const r2 = await call('/route', { from: DELHI, to: MANALI });
  check('the road is cached', r2.j.cached === true, JSON.stringify(r2.j).slice(0, 120));

  const q = await call('/quiet', { from: DELHI, to: MANALI });
  check('the 3am road answers', q.status === 200 && q.j.seconds > 0, JSON.stringify(q.j).slice(0, 120));
  if (q.j.seconds && r1.j.seconds) {
    console.log(`     traffic ratio right now: ×${(r1.j.seconds / q.j.seconds).toFixed(2)}`);
  }

  const bad = await call('/nearby', { lat: 'north', lng: 77, radiusKm: 40 });
  check('rubbish is refused', bad.status === 400, `${bad.status}`);

  console.log(`  ${'-'.repeat(56)}\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
