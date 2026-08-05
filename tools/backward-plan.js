#!/usr/bin/env node
/* A prototype of planning the stops backwards, next to what the app does now.
 *
 *     node tools/backward-plan.js
 *
 * The shipped planner walks forwards: drive until the charge runs out, look
 * back up to 120 km for a charger, take some of what is needed, repeat. It is
 * the obvious first design and it anchors on the wrong thing — where the
 * charge ran out — when the actual constraint is the one it meets last: arrive
 * with the reserve intact. And how much to take at each stop is decided by
 * chargePlan, which splits the deficit assuming every later stop begins at the
 * reserve, because that is all it can know. The road puts chargers where it
 * puts them.
 *
 * Backwards starts from the constraint. The last stop is the furthest one back
 * from which the destination is still reachable on a full charge; the stop
 * before it is the furthest one back from which *that* is reachable, and so on
 * until the start is in range. Each leg is therefore as long as it can be,
 * which is what "fewest stops" means, and each is measured in energy rather
 * than distance — 60 km of ghat and 60 km of plain are not the same journey.
 *
 * Nothing here writes to web/index.html. It prints both plans so the change
 * can be judged before it is made.
 */
const vm = require('vm');
const { loadEngine, drive, weatherFor } = require('./physics-test.js');

const env = loadEngine();
const S = vm.runInContext('S', env);

/* ---- the route ---------------------------------------------------------
   Delhi to Manali in shape: flat and slowly rising for two thirds, then the
   climb. It is the route the reported plans came from. */
const KM = 500;
const ghat = (i, n) => i < 340 ? 210 + i * 0.35
                               : 210 + 340 * 0.35 + (i - 340) * (2050 - 329) / (n - 340);

/* Chargers as they actually fall: in clumps, of uneven quality, with one site
   clearly better than its neighbours. Evenly spaced identical ones hide every
   interesting failure. */
const SITES = [
  [60, 50, 3.8, 1], [105, 60, 4.0, 2], [194, 60, 4.2, 2], [262, 50, 3.9, 2],
  [318, 120, 4.6, 6], [381, 60, 4.1, 2], [409, 50, 3.9, 2], [470, 60, 4.2, 2],
];

const { samples, elev } = drive({ km: KM, profile: ghat, spd: 70 });
const cfg = {
  cap: 52, kerb: 1650, people: 2, bags: 20, acPct: 40,
  cdA: 0.72 * 1.19, crr: 0.0095 * 1.19, soh: 100,
  style: 1, styleKey: 'normal', vhwy: 250, vroad: 250,
  regen: 0.65, regenKW: 60, dckw: 70,
  trafficRatio: 1, smoothWin: 1, step: 1000,
};
const sim = env.simulate({
  samples, elev, marks: weatherFor(samples, 24, 0),
  cal: { eta: 0.774, C: 0.990, learn: 1 }, cfg, startPct: 100,
});

const chargers = SITES.map(([km, kw, rating, bays]) => ({
  km, kw, rating, bays, i: km,
  name: `${kw >= 100 ? 'Mega' : 'Std'}@${km}`,
}));

env.findChargers = async (centre) => chargers
  .map(c => ({
    name: c.name, loc: samples[c.i].ll, kw: c.kw, points: c.bays, dc: true,
    plugs: ['CCS2'], working: true, membership: false,
    verified: new Date(), src: 't', url: '', rating: c.rating, votes: 60,
  }))
  .filter(c => Math.hypot((c.loc.lat - centre.lat) * 111, (c.loc.lng - centre.lng) * 95) < 50);

/* ---- backwards ---------------------------------------------------------
   Energy between two points comes straight off the no-charging trace:
   charging only shifts the curve, it does not change what a segment costs, so
   socTrace[a] - socTrace[b] is what the drive from a to b takes whatever the
   pack happened to hold. That is the same fact the itinerary builder relies on. */
const cost = (a, b) => sim.socTrace[a] - sim.socTrace[b];

function planBackwards(reserve, startPct, margin = 2) {
  const END = samples.length - 1;
  const FULL = 100;

  /* Pass one — where to stop, and how few times.
     Go as far as the charge allows and stop at the last charger still in
     reach. That is the textbook minimum-refuelling greedy and it is provably
     the fewest stops; picking the furthest one *back* instead also gives the
     right count but plants them far too early — it had the car pulling in at
     60 km with 83% in the pack. */
  const chosen = [];
  let at = 0, soc = startPct;
  for (let guard = 0; guard < 8; guard++) {
    if (soc - cost(at, END) >= reserve - 1e-9) break;        // home from here

    let best = null;
    for (const c of chargers) {
      if (c.i <= at) continue;
      if (soc - cost(at, c.i) < reserve - 1e-9) continue;    // cannot reach it
      if (!best || c.i > best.i) best = c;                   // the furthest we can reach
    }
    if (!best) return { stops: null, why: `nothing reachable past ${samples[at].s / 1000 | 0} km` };

    chosen.push(best);
    soc = FULL;                                              // assume a fill, for now
    at = best.i;
  }
  if (!chosen.length) return { stops: [], endPct: startPct - cost(0, END) };

  /* Pass two — how much to take, decided backwards.
     Each stop only needs enough for the leg in front of it, and by now that
     leg is known rather than guessed. This is the part chargePlan cannot do:
     it splits the deficit across an imagined future in which every later stop
     begins at the reserve. */
  const targets = new Array(chosen.length);
  let needAt = reserve;                                      // what must be left at the end
  for (let k = chosen.length - 1; k >= 0; k--) {
    const nextIdx = (k + 1 < chosen.length) ? chosen[k + 1].i : END;
    targets[k] = Math.min(FULL, cost(chosen[k].i, nextIdx) + needAt + margin);
    needAt = reserve;                                        // arrive at the next one on the floor
  }

  /* And walk it forwards once to read off what actually happens. */
  const out = []; soc = startPct; at = 0;
  for (let k = 0; k < chosen.length; k++) {
    const arrive = soc - cost(at, chosen[k].i);
    const target = Math.max(arrive, targets[k]);
    out.push({ km: chosen[k].km, name: chosen[k].name, kw: chosen[k].kw, arrive, target });
    soc = target; at = chosen[k].i;
  }
  return { stops: out, endPct: soc - cost(at, END) };
}

/* ---- print both -------------------------------------------------------- */
function show(title, rows, endPct) {
  console.log(`\n  ${title}`);
  console.log('  ' + '-'.repeat(58));
  if (!rows || !rows.length) { console.log('   no stops'); return; }
  let prev = 0;
  rows.forEach((r, i) => {
    const leg = r.km - prev; prev = r.km;
    console.log(`   ${i + 1}. ${String(Math.round(r.km)).padStart(3)} km  ${(r.name || '').padEnd(10)}`
      + `arrive ${r.arrive.toFixed(0).padStart(3)}%  ->  ${r.target.toFixed(0).padStart(3)}%`
      + `   (leg ${String(Math.round(leg)).padStart(3)} km)`);
  });
  console.log(`   ${rows.length} stop${rows.length === 1 ? '' : 's'}`
    + (endPct != null ? `, arriving at ${endPct.toFixed(0)}%` : ''));
}

(async () => {
  for (const reserve of [50, 30, 20]) {
    console.log(`\n\n  ══ reserve ${reserve}%, starting at 100% ══`);
    S.strategy = 'time';
    const fwd = (await env.planStops(sim, samples, reserve, '', cfg, null)).filter(s => !s.none);
    show('now — forwards, chargePlan splits the deficit',
      fwd.map(s => ({ km: s.km, name: s.best.name, arrive: s.arrive, target: s.target })),
      fwd.length ? fwd[fwd.length - 1].after : null);

    const back = planBackwards(reserve, 100);
    show('proposed — backwards from the arrival constraint', back.stops, back.endPct);
  }
  console.log('');
})();
