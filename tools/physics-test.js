#!/usr/bin/env node
/* Runs the planner's own simulate() over a set of synthetic drives and checks
 * it against physics, not against a second copy of itself.
 *
 *     node tools/physics-test.js
 *
 * The engine in web/index.html is one <script> that wires itself to the DOM as
 * it loads, so it cannot simply be required. A stub document is enough: every
 * getElementById returns the same inert element, addEventListener does nothing,
 * and the numeric fields answer with whatever this harness sets. The point is
 * that simulate(), hvacWatts(), the regen limits and the SOC bookkeeping are
 * the shipped ones — a test that re-implements the model can only ever agree
 * with itself.
 *
 * What is asserted is what physics fixes, not what looks about right:
 * conservation on a round trip, monotonicity in climb and speed, the gradient
 * below which regen cannot happen, and that a pack never holds more than full.
 * Absolute accuracy is not testable here and is not claimed — that needs a
 * real drive, which is what the trip log is for.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

/* The page under test. EVROUTE_SRC points it at another copy — an older
   checkout, say — so two versions of the planner can be compared side by side
   without either of them being the one on disk. */
const SRC = process.env.EVROUTE_SRC || path.join(__dirname, '..', 'web', 'index.html');

/* ---- the stub DOM ------------------------------------------------------ */
const FIELDS = {};                       // id -> value, set per scenario
/* A stub with just enough tree in it to be wrong about.

   It used to answer appendChild with nothing and querySelectorAll with an
   empty list, which meant no test could tell a card that had been added from
   one that had not — and that is exactly the bug that shipped: the popup was
   created with a class and looked up by id, so it was never found and never
   removed, and taps stacked cards on top of each other. Children are real
   here now, remove detaches, and querySelectorAll understands a class
   selector. Nothing more; this is not a browser. */
function makeEl(id, tag) {
  const el = {
    id, tag: tag || 'div', parentNode: null, className: '',
    style: { setProperty(){}, cssText:'' },
    dataset: {},
    children: [], hidden: false, disabled: false, textContent: '', innerHTML: '',
    get value() { return FIELDS[id] !== undefined ? String(FIELDS[id]) : ''; },
    set value(v) { FIELDS[id] = v; },
    addEventListener(){}, removeEventListener(){},
    appendChild(c){ if(c){ c.parentNode = this; this.children.push(c); } return c; },
    remove(){
      const p = this.parentNode;
      if(!p) return;
      const i = p.children.indexOf(this);
      if(i >= 0) p.children.splice(i, 1);
      this.parentNode = null;
    },
    querySelector(sel){ return this.querySelectorAll(sel)[0] || makeEl('q'); },
    querySelectorAll(sel){
      const want = String(sel||'').replace(/^\./, '');
      const hit = [];
      const walk = n => n.children.forEach(c => {
        if(String(c.className||'').split(/\s+/).includes(want)) hit.push(c);
        walk(c);
      });
      walk(this);
      return hit;
    },
    closest(){ return null; }, getBoundingClientRect(){ return {width:0,height:0,left:0,top:0}; },
    setAttribute(){}, getAttribute(){ return null; }, focus(){}, blur(){},
    scrollTo(){}, scrollIntoView(){}, insertAdjacentHTML(){}, cloneNode(){ return makeEl(id); },
  };
  /* classList over the same string the selector reads, so the two agree. */
  el.classList = {
    add(...v){ const s = new Set(String(el.className).split(/\s+/).filter(Boolean));
               v.forEach(x=>s.add(x)); el.className = [...s].join(' '); },
    remove(...v){ const s = new Set(String(el.className).split(/\s+/).filter(Boolean));
               v.forEach(x=>s.delete(x)); el.className = [...s].join(' '); },
    toggle(){}, contains(v){ return String(el.className).split(/\s+/).includes(v); },
  };
  return el;
}

const EL = new Proxy({}, { get: (t, k) => (t[k] || (t[k] = makeEl(String(k)))) });

function loadEngine() {
  const html = fs.readFileSync(SRC, 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const engine = blocks.find(b => b.includes('function simulate'));
  if (!engine) throw new Error('engine block not found in web/index.html');

  const document = {
    getElementById: id => EL[id],
    querySelector: () => makeEl('q'), querySelectorAll: () => [],
    addEventListener(){}, createElement: t => makeEl('new', t),
    documentElement: makeEl('html'), head: makeEl('head'), body: makeEl('body'),
  };
  const sandbox = {
    document, console,
    window: { matchMedia: () => ({ matches:false, addEventListener(){} }), addEventListener(){} },
    /* A store that remembers. It used to answer null to everything, which made
       every persistence bug invisible here — including the one where the app
       forgot which car you drive the moment it was killed. */
    localStorage: (() => {
      const m = new Map();
      return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: k => { m.delete(k); },
        key: i => [...m.keys()][i],
        get length(){ return m.size; },
      };
    })(),
    navigator: { geolocation: null },
    setTimeout, clearTimeout, setInterval, clearInterval, fetch: () => Promise.reject(new Error('offline')),
    Math, Date, JSON, Promise, Object, Array, String, Number, Boolean, Error, Map, Set, isFinite, parseFloat, parseInt,
    AbortController: class { constructor(){ this.signal = {}; } abort(){} },
    Image: class {}, URL, encodeURIComponent, decodeURIComponent, atob: s => Buffer.from(s,'base64').toString('binary'),
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(engine, sandbox, { filename: 'web/index.html#engine' });
  return sandbox;
}

/* ---- building a drive -------------------------------------------------- */
/* samples carry cumulative distance, a point, and the router's speed for it;
 * elev is metres at each sample. One sample per kilometre, which is what the
 * app's own default sampling produces. */
function drive({ km, profile, spd }) {
  const samples = [], elev = [];
  for (let i = 0; i <= km; i++) {
    samples.push({ s: i * 1000, ll: { lat: 30 + i * 0.009, lng: 77 }, spd: spd / 3.6, brg: 0 });
    elev.push(profile(i, km));
  }
  return { samples, elev };
}
const flat      = h => () => h;
const climbTo   = (h0, h1) => (i, n) => h0 + (h1 - h0) * (i / n);
const rolling   = (h, amp, period) => i => h + amp * Math.sin(2 * Math.PI * i / period);
const overPass  = (h0, top) => (i, n) => h0 + (top - h0) * Math.sin(Math.PI * i / n);

function weatherFor(samples, tempC, windMs) {
  return samples.map((s, i) => ({ i, ll: s.ll, temp: tempC, wind: windMs, wdir: 0, rain: 0 }));
}

function run(env, scenario, opts = {}) {
  const { samples, elev } = drive(scenario);
  const marks = weatherFor(samples, opts.temp ?? 25, opts.wind ?? 0);
  const cfg = {
    cap: 51.4, kerb: 1720, people: 2, bags: 40, acPct: 40,
    cdA: 0.78 * 0.91, crr: 0.0095 * 0.91, soh: 100,
    /* The app caps cruise at the driving style's own ceiling, so a scenario
       asking for 110 km/h would silently be simulated at 75 and two different
       speeds would return the same answer. Raised here so the scenario's speed
       is the one actually driven — the cap is app behaviour worth having, but
       it is not what these checks are about. */
    style: 1, styleKey: 'normal', vhwy: 200, vroad: 200,
    regen: 0.65, regenKW: 60, dckw: 100,
    trafficRatio: 1, trafficWhy: '',
    /* One sample per kilometre, which is what the app's default sampling
       gives — and at that spacing smoothWindow() returns 1, meaning the long
       baseline has already averaged the terrain model's noise away. */
    smoothWin: env.smoothWindow ? env.smoothWindow(1000) : 1, step: 1000,
    ...(opts.cfg || {}),
  };
  const cal = { eta: 0.774, C: 0.990, learn: 1, ...(opts.cal || {}) };
  const sim = env.simulate({ samples, elev, marks, cal, cfg, startPct: opts.startPct ?? 100 });
  return { sim, cfg, kwh: (((opts.startPct ?? 100) - sim.endPct) / 100) * cfg.cap };
}

/* ---- the scenarios ----------------------------------------------------- */
const SCENARIOS = [
  ['flat highway, 400 km, 90',        { km: 400, profile: flat(200),                 spd: 90 }],
  ['flat highway, 400 km, 70',        { km: 400, profile: flat(200),                 spd: 70 }],
  ['flat highway, 400 km, 110',       { km: 400, profile: flat(200),                 spd: 110 }],
  ['city crawl, 40 km, 25',           { km: 40,  profile: flat(200),                 spd: 25 }],
  ['town roads, 80 km, 45',           { km: 80,  profile: flat(200),                 spd: 45 }],
  ['rolling plain, 200 km',           { km: 200, profile: rolling(250, 40, 25),      spd: 80 }],
  ['rolling downs, 200 km, deep',     { km: 200, profile: rolling(250, 120, 40),     spd: 70 }],
  ['gentle climb, 150 km +600',       { km: 150, profile: climbTo(200, 800),         spd: 70 }],
  ['gentle drop, 150 km -600',        { km: 150, profile: climbTo(800, 200),         spd: 70 }],
  ['ghat climb, 110 km +1250',        { km: 110, profile: climbTo(800, 2050),        spd: 40 }],
  ['ghat drop, 110 km -1250',         { km: 110, profile: climbTo(2050, 800),        spd: 40 }],
  ['steep ghat climb, 40 km +1800',   { km: 40,  profile: climbTo(400, 2200),        spd: 35 }],
  ['steep ghat drop, 40 km -1800',    { km: 40,  profile: climbTo(2200, 400),        spd: 35 }],
  ['over a pass, 220 km, 2500 top',   { km: 220, profile: overPass(600, 2500),       spd: 45 }],
  ['high plateau, 180 km @3500',      { km: 180, profile: flat(3500),                spd: 55 }],
  ['coastal flat, 300 km, hot',       { km: 300, profile: flat(20),                  spd: 85 }, { temp: 40 }],
  ['winter highway, 300 km, cold',    { km: 300, profile: flat(300),                 spd: 85 }, { temp: 2 }],
  ['headwind highway, 300 km',        { km: 300, profile: flat(200),                 spd: 85 }, { wind: 11 }],
  ['stop-go traffic, 60 km',          { km: 60,  profile: flat(200),                 spd: 40 }, { cfg: { trafficRatio: 1.6 } }],
  ['long haul, 700 km mixed',         { km: 700, profile: rolling(300, 90, 60),      spd: 85 }],
  ['short hop, 15 km',                { km: 15,  profile: flat(200),                 spd: 50 }],
  ['descent on a full pack',          { km: 40,  profile: climbTo(2200, 400),        spd: 35 }, { startPct: 99 }],
];

/* ---- checks ------------------------------------------------------------ */
let pass = 0, fail = 0;
const bad = [];
function check(name, ok, detail) {
  if (ok) { pass++; } else { fail++; bad.push(`${name} — ${detail}`); }
}

async function main() {
  const env = loadEngine();
  if (typeof env.simulate !== 'function') throw new Error('simulate() did not load');

  console.log(`\n  ${'drive'.padEnd(32)}${'kWh'.padStart(7)}${'Wh/km'.padStart(8)}${'end %'.padStart(8)}`);
  console.log('  ' + '-'.repeat(55));

  const results = {};
  for (const [name, sc, opts] of SCENARIOS) {
    const r = run(env, sc, opts);
    results[name] = r;
    const whkm = (r.kwh * 1000) / sc.km;
    console.log(`  ${name.padEnd(32)}${r.kwh.toFixed(2).padStart(7)}${whkm.toFixed(0).padStart(8)}${r.sim.endPct.toFixed(1).padStart(8)}`);

    /* Nothing should ever leave the pack fuller than it started, or consume a
       physically absurd amount. The band is wide on purpose — it is there to
       catch a sign error or a runaway term, not to encode an opinion. */
    check(`${name}: SOC in range`, r.sim.endPct <= (opts?.startPct ?? 100) + 0.001 && r.sim.endPct > -200,
          `endPct ${r.sim.endPct.toFixed(1)}`);
    /* A net descent legitimately costs almost nothing, so the floor only
       applies where the drive is not mostly downhill. The band is wide on
       purpose: it catches a sign error or a runaway term, not an opinion. */
    const netDrop = sc.profile(0, sc.km) - sc.profile(sc.km, sc.km);
    const floor = netDrop > 200 ? 0 : 20;
    check(`${name}: consumption plausible`, whkm > floor && whkm < 600, `${whkm.toFixed(0)} Wh/km`);
    check(`${name}: soc trace never above full`, Math.max(...r.sim.socTrace) <= (opts?.startPct ?? 100) + 0.001,
          `peak ${Math.max(...r.sim.socTrace).toFixed(1)}%`);
  }

  console.log('\n  invariants');
  console.log('  ' + '-'.repeat(55));

  /* Conservation: up then down must cost the flat-equivalent plus exactly the
     part of the potential energy that regen does not return. */
  /* Steep enough that regen actually engages: below about 1.2% at this speed
     gravity does not even cover rolling and aero, nothing is returned to the
     pack, and the identity below does not apply. Real ghats are 4-6%. */
  const up   = run(env, { km: 40, profile: climbTo(400, 1900), spd: 40 });
  /* Descending from where the climb left off, not from full. Starting the
     down leg at 100% would find the pack unable to accept anything, regen
     switched off by the headroom guard, and the identity below meaningless —
     which is real behaviour, and the reason a round trip has to be simulated
     in sequence rather than as two separate drives. */
  const down = run(env, { km: 40, profile: climbTo(1900, 400), spd: 40 },
                   { startPct: up.sim.endPct });
  const flatEq = run(env, { km: 80, profile: flat(400), spd: 40 });
  const m = 1720 + 2 * 75 + 40, rho = 101325 / (287.05 * 298.15), v = 40 / 3.6;
  const RL = 0.0095 * 0.91 * m * 9.81 + 0.5 * rho * 0.78 * 0.91 * v * v;
  /* Round trip minus the flat equivalent comes out as
       (1/eta - regen) x (m·g·h - RL·L)
     — the road load over the descent is paid by gravity rather than the pack,
     so it leaves the identity too. */
  const theory = ((1 / 0.774 - 0.65) * (m * 9.81 * 1500 - RL * 40000)) / 3.6e6;
  const extra = up.kwh + down.kwh - flatEq.kwh;
  console.log(`  round trip over flat-equivalent : ${extra.toFixed(2)} kWh (theory ${theory.toFixed(2)})`);
  check('conservation on a round trip', Math.abs(extra - theory) < 0.25,
        `${extra.toFixed(2)} vs ${theory.toFixed(2)} kWh`);

  /* Monotonic in the things it must be monotonic in. */
  const s70  = run(env, { km: 300, profile: flat(200), spd: 70 }).kwh;
  const s90  = run(env, { km: 300, profile: flat(200), spd: 90 }).kwh;
  const s110 = run(env, { km: 300, profile: flat(200), spd: 110 }).kwh;
  check('faster costs more', s70 < s90 && s90 < s110, `${s70.toFixed(1)} ${s90.toFixed(1)} ${s110.toFixed(1)}`);
  console.log(`  70 / 90 / 110 km/h              : ${s70.toFixed(1)} / ${s90.toFixed(1)} / ${s110.toFixed(1)} kWh`);

  const c0 = run(env, { km: 150, profile: flat(500), spd: 50 }).kwh;
  const c1 = run(env, { km: 150, profile: climbTo(500, 1200), spd: 50 }).kwh;
  const c2 = run(env, { km: 150, profile: climbTo(500, 1900), spd: 50 }).kwh;
  check('more climb costs more', c0 < c1 && c1 < c2, `${c0.toFixed(1)} ${c1.toFixed(1)} ${c2.toFixed(1)}`);
  console.log(`  +0 / +700 / +1400 m of climb    : ${c0.toFixed(1)} / ${c1.toFixed(1)} / ${c2.toFixed(1)} kWh`);

  const warm = run(env, { km: 250, profile: flat(200), spd: 60 }, { temp: 25 }).kwh;
  const cold = run(env, { km: 250, profile: flat(200), spd: 60 }, { temp: 0 }).kwh;
  check('cold costs more than warm', cold > warm, `${cold.toFixed(1)} vs ${warm.toFixed(1)}`);
  console.log(`  25 C / 0 C                      : ${warm.toFixed(1)} / ${cold.toFixed(1)} kWh`);

  /* Direction must matter, and by more than rounding. */
  const asc = run(env, { km: 110, profile: climbTo(800, 2050), spd: 40 }).kwh;
  const dsc = run(env, { km: 110, profile: climbTo(2050, 800), spd: 40 }).kwh;
  check('uphill costs more than downhill', asc > dsc * 1.3, `${asc.toFixed(1)} vs ${dsc.toFixed(1)}`);
  console.log(`  same ghat up / down             : ${asc.toFixed(1)} / ${dsc.toFixed(1)} kWh`);

  /* A pack that is nearly full cannot take the descent's charge, so the same
     road must cost more when you start it full. */
  const emptyish = run(env, { km: 40, profile: climbTo(2200, 400), spd: 35 }, { startPct: 40 }).kwh;
  const fullish  = run(env, { km: 40, profile: climbTo(2200, 400), spd: 35 }, { startPct: 99 }).kwh;
  check('full pack cannot absorb regen', fullish > emptyish, `${fullish.toFixed(2)} vs ${emptyish.toFixed(2)}`);
  console.log(`  descent from 40% / 99%          : ${emptyish.toFixed(2)} / ${fullish.toFixed(2)} kWh`);

  /* Stops in order, and never two of them on top of each other.
     Reported from a real Delhi-Manali plan: charge at 318 km, drive 8 km,
     charge again. The search looks backwards from where charge runs out, and
     on a route that drains fast that window reaches back past the last stop —
     so the best-scoring charger, the one just used, won a second time. */
  console.log('\n  stop spacing');
  console.log('  ' + '-'.repeat(55));
  const KM = 500;
  const ghat = (i, n) => i < 340 ? 210 + i * 0.35
                                 : 210 + 340 * 0.35 + (i - 340) * (2050 - 329) / (n - 340);
  const { samples: gs, elev: ge } = drive({ km: KM, profile: ghat, spd: 70 });
  const gcfg = { cap: 52, kerb: 1650, people: 2, bags: 20, acPct: 40,
    cdA: 0.72 * 1.19, crr: 0.0095 * 1.19, soh: 100, style: 1, styleKey: 'normal',
    vhwy: 250, vroad: 250, regen: 0.65, regenKW: 60, dckw: 70,
    trafficRatio: 1, smoothWin: 1, step: 1000 };
  const gsim = env.simulate({ samples: gs, elev: ge, marks: weatherFor(gs, 24, 0),
    cal: { eta: 0.774, C: 0.990, learn: 1 }, cfg: gcfg, startPct: 100 });
  /* Uneven quality matters: with every charger identical the scoring picks the
     nearest and the bug never shows. It needs one that is clearly the best. */
  const AT = [[60,50,3.8,1],[105,60,4.0,2],[194,60,4.2,2],[200,25,3.2,1],[262,50,3.9,2],
              [318,120,4.6,6],[326,60,4.1,2],[383,50,3.7,1],[390,60,4.0,2],[440,50,3.9,2],[470,60,4.2,2]];
  env.findChargers = async (centre) => AT
    .map(([km, kw, rating, bays]) => ({ name: `C@${km}`, loc: gs[km].ll, kw, points: bays,
      dc: true, plugs: ['CCS2'], working: true, membership: false,
      verified: new Date(), src: 't', url: '', rating, votes: 60 }))
    .filter(c => Math.hypot((c.loc.lat - centre.lat) * 111, (c.loc.lng - centre.lng) * 95) < 50);

  for (const reserve of [20, 35, 50]) {
    const planned = (await env.planStops(gsim, gs, reserve, '', gcfg, null)).filter(s => !s.none);
    const kms = planned.map(s => Math.round(s.km));
    let tooClose = 0, backwards = 0;
    for (let i = 1; i < kms.length; i++) {
      if (kms[i] - kms[i - 1] < 25) tooClose++;
      if (kms[i] <= kms[i - 1]) backwards++;
    }
    console.log(`  reserve ${String(reserve).padStart(2)}%  stops at ${kms.join(', ') || '-'}`);
    check(`stops ${reserve}%: none within 25 km of the last`, tooClose === 0, `${tooClose} too close`);
    check(`stops ${reserve}%: strictly forward`, backwards === 0, `${backwards} not after the last`);
    /* Fewest stops is the point of planning backwards from the arrival
       constraint, so it is worth asserting rather than admiring: nobody
       should need more than one stop per 150 km on a route like this. */
    check(`stops ${reserve}%: not more than the route needs`,
      planned.length <= Math.ceil(KM / 150), `${planned.length} stops for ${KM} km`);
  }

  /* The two strategies, which are only worth offering if they differ and only
     honest if each wins at the thing it is named after. Least time is allowed
     to spend a stop; what it may never do is come back slower than the plan
     that spends fewer. That is not obvious from the code — both come out of
     the same search with a different price on a stop — so it is asserted. */
  console.log('\n  charging strategy');
  console.log('  ' + '-'.repeat(55));
  const S = vm.runInContext('S', env);
  vm.runInContext('CHG_CACHE.clear()', env);
  const clock = (plan) => plan.reduce((t, s) =>
    t + env.chargeCurveMinutes(s.arrive, s.target, gcfg.cap,
          Math.min(s.best && s.best.kw > 0 ? s.best.kw : 50, gcfg.dckw))
      + (s.detour || 0) * 2 / 45 * 60 + 10, 0);

  for (const reserve of [20, 35, 50]) {
    S.strategy = 'time';
    const t = (await env.planStops(gsim, gs, reserve, '', gcfg, null)).filter(s => !s.none);
    S.strategy = 'stops';
    const f = (await env.planStops(gsim, gs, reserve, '', gcfg, null)).filter(s => !s.none);
    S.strategy = 'time';
    console.log(`  reserve ${String(reserve).padStart(2)}%  least time ${t.length} stops `
      + `${clock(t).toFixed(0)} min   fewest stops ${f.length} stops ${clock(f).toFixed(0)} min`);
    check(`strategy ${reserve}%: fewest stops does not stop more often`,
      f.length <= t.length, `${f.length} vs ${t.length}`);
    check(`strategy ${reserve}%: least time is not the slower plan`,
      clock(t) <= clock(f) + 0.5, `${clock(t).toFixed(1)} vs ${clock(f).toFixed(1)} min`);
    /* Whatever the answer is, the card has to account for the setting. When
       the two plans differ it quotes the other one; when they agree it has to
       say they agree, because a toggle that silently returns the same plan is
       indistinguishable from a toggle that does nothing — which is what it
       looked like from the outside. */
    const identical = t.length === f.length && t.every((x,k)=>x.i === f[k].i);
    const note = t[0] && t[0].alt;
    check(`strategy ${reserve}%: the plan says which case it is`, !!note, 'no note at all');
    check(`strategy ${reserve}%: agreement is reported as agreement`,
      !note || !!note.same === identical,
      `same=${note&&note.same} but plans ${identical?'match':'differ'}`);
    check(`strategy ${reserve}%: a real alternative is quoted with its cost`,
      !note || note.same || (note.stops === f.length && Number.isFinite(note.deltaMin)),
      JSON.stringify(note));
    check(`strategy ${reserve}%: both arrive on the reserve`,
      (!t.length || t[t.length-1].after >= reserve - 1) &&
      (!f.length || f[f.length-1].after >= reserve - 1),
      `${t.length ? t[t.length-1].after.toFixed(1) : '-'} / ${f.length ? f[f.length-1].after.toFixed(1) : '-'}`);
  }

  /* AC posts, and chargers of different speeds. The AC sites here are the most
     attractive things on the route by every other measure — better rated, more
     bays, right where the car runs low — which is exactly the case that used to
     get one into a plan on a scoring penalty alone. And two DC sites of the
     same quality but different power must not cost the same to use. */
  console.log('\n  chargers');
  console.log('  ' + '-'.repeat(55));
  const MIX = [[60,50,3.8,1,1],[105,7.4,4.9,6,0],[110,60,4.0,2,1],[194,22,5.0,8,0],
               [200,25,4.0,2,1],[262,50,3.9,2,1],[318,120,4.6,6,1],[381,60,4.1,2,1],
               [409,50,3.9,2,1],[470,60,4.2,2,1]];
  /* The plan-level cache holds a circle for six hours, which is right in the
     app and wrong here: without clearing it this whole block would be checked
     against the previous block's chargers and pass without ever seeing an AC
     post. It did, before this line existed. */
  vm.runInContext('CHG_CACHE.clear()', env);
  env.findChargers = async (centre) => MIX
    .map(([km, kw, rating, bays, dc]) => ({ name: `${dc?'DC':'AC'}${kw}@${km}`, loc: gs[km].ll,
      kw, points: bays, dc: !!dc, plugs: [dc ? 'CCS2' : 'Type2'], working: true,
      membership: false, verified: new Date(), src: 't', url: '', rating, votes: 60 }))
    .filter(c => Math.hypot((c.loc.lat - centre.lat) * 111, (c.loc.lng - centre.lng) * 95) < 50);

  for (const reserve of [30, 50]) {
    const p = (await env.planStops(gsim, gs, reserve, '', gcfg, null)).filter(x => !x.none);
    const acs = p.filter(x => x.best && !x.best.dc);
    const alts = p.flatMap(x => x.list || []).filter(c => !c.dc);
    console.log(`  reserve ${reserve}%  ${p.map(x => x.best.name).join(', ')}`);
    check(`chargers ${reserve}%: no AC post is a planned stop`, acs.length === 0,
      acs.map(x => x.best.name).join(','));
    check(`chargers ${reserve}%: no AC post offered as an alternative`, alts.length === 0,
      alts.map(c => c.name).join(','));
    check(`chargers ${reserve}%: every stop quotes its own charger's speed`,
      p.every(x => Math.abs(x.minutes - env.chargeCurveMinutes(x.arrive, x.target, gcfg.cap,
        Math.min(x.best.kw, gcfg.dckw))) < 0.01),
      p.map(x => `${x.best.name} ${x.minutes.toFixed(1)}`).join(' '));
  }

  /* A real Google reply, in the shape that used to draw a green pin over a
     station whose DC guns were both busy. Function declarations land on the
     sandbox global, so the network call can be replaced from out here. */
  const SITE = { places: [{
    displayName: { text: 'Mixed site' },
    location: { latitude: 28.6, longitude: 77.2 },
    evChargeOptions: { connectorCount: 4, connectorAggregation: [
      { type: 'EV_CONNECTOR_TYPE_CCS_COMBO_2', count: 2, availableCount: 0, maxChargeRateKw: 60 },
      { type: 'EV_CONNECTOR_TYPE_TYPE_2',      count: 2, availableCount: 2, maxChargeRateKw: 7.4 },
    ] } }] };
  const realFetch = env.chgFetch;
  env.chgFetch = async () => ({ ok: true, status: 200, json: async () => SITE });
  const [got] = await env.chargersGoogle({ lat: 28.6, lng: 77.2 }, 40, 'k');
  env.chgFetch = realFetch;
  console.log(`  mixed site: 2 DC guns busy, 2 AC sockets free -> free ${got.free}, bays ${got.points}`);
  check('AC sockets do not count as a free gun', got.free === 0, `free ${got.free}`);
  check('bays counted are the DC ones', got.points === 2, `${got.points} bays`);
  check('a mixed site is still a DC site', got.dc === true, `dc ${got.dc}`);

  /* And a site that reports nothing stays unknown rather than reading as busy —
     amber and grey mean different things to a driver. */
  const QUIET = { places: [{ displayName:{text:'Quiet'}, location:{latitude:28.6,longitude:77.2},
    evChargeOptions:{ connectorAggregation:[
      { type:'EV_CONNECTOR_TYPE_CCS_COMBO_2', count:2, maxChargeRateKw:60 }] } }] };
  env.chgFetch = async () => ({ ok: true, status: 200, json: async () => QUIET });
  const [quiet] = await env.chargersGoogle({ lat: 28.6, lng: 77.2 }, 40, 'k');
  env.chgFetch = realFetch;
  check('a site that reports nothing is unknown, not busy', quiet.free === null, `free ${quiet.free}`);

  /* The same charge, on posts a car can and cannot saturate. */
  const slow = env.chargeCurveMinutes(30, 80, 52, Math.min(25, 70));
  const fast = env.chargeCurveMinutes(30, 80, 52, Math.min(120, 70));
  console.log(`  30->80% on a 25 kW post ${slow.toFixed(0)} min, on a 120 kW post ${fast.toFixed(0)} min`);
  check('a slow post takes longer than a fast one', slow > fast * 2,
    `${slow.toFixed(1)} vs ${fast.toFixed(1)} min`);
  check('the car caps what a fast post gives',
    Math.abs(fast - env.chargeCurveMinutes(30, 80, 52, 70)) < 0.01, 'car limit not applied');

  /* What the card on the map says, without a browser to click in. Names come
     from databases anyone can edit, so the escaping is the part worth pinning
     down: it is the only thing standing between a station title and innerHTML. */
  const evalIn = c => vm.runInContext(c, env);
  console.log('\n  the charger card');
  console.log('  ' + '-'.repeat(55));
  const nasty = evalIn('esc(`<img src=x onerror=alert(1)>`)');
  console.log(`  a station named <img ...> renders as ${nasty}`);
  check('a charger name cannot carry markup', !/[<>]/.test(nasty), nasty);
  check('an empty name stays empty', evalIn('esc(null)') === '', 'null leaked');

  const rows = evalIn('gunRows({guns:[{plug:"CCS2",kw:60,count:2,free:1},'
                 + '{plug:"CHAdeMO",kw:50,count:1,free:0}]})');
  console.log('  ' + rows.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  const pips  = h => (h.match(/<i class="on"><\/i>/g)||[]).length;
  const group = (h, name) => (h.split('<li>').find(x => x.includes(name)) || '');
  check('the free group lights one pip of two',
    pips(group(rows,'CCS2')) === 1 && (group(rows,'CCS2').match(/<i /g)||[]).length === 2,
    group(rows,'CCS2'));
  check('the busy group lights none', pips(group(rows,'CHAdeMO')) === 0, group(rows,'CHAdeMO'));
  check('a site that reports nothing says so',
    /does not report/.test(evalIn('gunRows({})')), 'silent');
  /* Unknown must not look like busy: dashed pips, not empty ones. */
  const unknown = evalIn('gunRows({guns:[{plug:"CCS2",kw:60,count:2,free:null}]})');
  check('unknown availability is drawn differently from none free',
    (unknown.match(/class="unk"/g)||[]).length === 2 && pips(unknown) === 0, unknown);

  /* One reader for the charging half of a Google place, whether it arrives in a
     corridor sweep or in a check-now on a single site. It was written twice at
     first and the copies disagreed within the hour about out-of-service guns. */
  const EV = { connectorCount: 5, connectorAggregation: [
    { type:'EV_CONNECTOR_TYPE_CCS_COMBO_2', count:3, availableCount:1, outOfServiceCount:1,
      maxChargeRateKw:60, availabilityLastUpdateTime:'2026-08-06T09:00:00Z' },
    { type:'EV_CONNECTOR_TYPE_TYPE_2', count:2, availableCount:2, maxChargeRateKw:7.4 }]};
  const ev = evalIn('readEV(' + JSON.stringify(EV) + ')');
  console.log(`  mixed site read as ${ev.points} DC bays, ${ev.free} free, ${ev.dead} out of service`);
  check('the AC sockets stay out of the bay count', ev.points === 3, `${ev.points}`);
  check('the AC sockets stay out of the free count', ev.free === 1, `${ev.free}`);
  check('an out-of-service gun is counted', ev.dead === 1, `${ev.dead}`);
  check('the site still reads as DC', ev.dc === true, `${ev.dc}`);
  /* Google's own timestamp, not ours. A cache entry can be a minute old and
     carry a count the network last refreshed this morning. */
  check("google's availability timestamp is kept",
    ev.liveAt === Date.parse('2026-08-06T09:00:00Z'), `${ev.liveAt}`);

  const dead = evalIn('gunRows({guns:[{plug:"CCS2",kw:60,count:3,free:1,dead:1}]})');
  check('a broken gun is drawn apart from a busy one',
    (dead.match(/class="dead"/g)||[]).length === 1 && (dead.match(/<i class="on">/g)||[]).length === 1,
    dead);

  /* A saved plan has to come back in the shape render() was written against,
     and it has to fit in a store the charger cache already lives in. Both are
     asserted, because the failure here is a plan that saves cleanly and opens
     broken a week later, on a phone that is nowhere near a charger. */
  console.log('\n  saved plans');
  console.log('  ' + '-'.repeat(55));
  env.PACK_IN = { sim: gsim, samples: gs, marks: weatherFor(gs, 24, 0), cfg: gcfg,
                  cal: {eta:0.774, C:0.99, learn:1}, reserve: 20, arriveWith: 20,
                  legs: [], srcNote: '', alias: null,
                  itinerary: {rows:[], stopCount:0}, stops: [],
                  reserveHit: null, emptyHit: null };
  const packed = evalIn('packPlan(PACK_IN, {from:"Delhi", to:"Manali", car:"Curvv",'
                      + ' stops:2, endPct:41, form:{}})');
  const kb = JSON.stringify(packed).length / 1024;
  console.log(`  a ${Math.round(gsim.dist)} km plan packs to ${kb.toFixed(1)} KB`
            + ` — ten of them ${(kb*10/1024).toFixed(2)} MB`);
  check('a saved plan stays small enough to keep ten of',
    kb * 10 < 1024, `${(kb*10/1024).toFixed(2)} MB for ten`);

  env.PACKED = packed;
  const back = evalIn('unpackPlan(PACKED)');
  const NEEDS = ['sim','samples','marks','cfg','cal','reserve','arriveWith','legs',
                 'srcNote','alias','itinerary','stops','reserveHit','emptyHit'];
  const missing = NEEDS.filter(k => !(k in back));
  check('everything render reads survives the round trip', missing.length === 0,
    'missing ' + missing.join(', '));
  check('the route comes back whole',
    back.samples.length === gs.length && typeof back.samples[0].ll.lat === 'number',
    `${back.samples.length} of ${gs.length}`);
  check('the traces come back whole',
    back.sim.socTrace.length === gs.length && back.sim.sm.length === gs.length
    && back.sim.timeTrace.length === gs.length, 'a trace changed length');

  /* Rounding is the price of the size, so it is worth knowing what it costs. */
  const socErr = Math.max(...gsim.socTrace.map((v,i)=>Math.abs(v - back.sim.socTrace[i])));
  const posErr = Math.max(...gs.map((x,i)=>Math.abs(x.ll.lat - back.samples[i].ll.lat))) * 111000;
  console.log(`  rounding costs ${socErr.toFixed(3)} points of charge and ${posErr.toFixed(1)} m of position`);
  check('rounding does not move the charge curve', socErr < 0.01, `${socErr}`);
  check('rounding does not move the road', posErr < 1, `${posErr} m`);

  /* The round trip above proved the data survives. It did not prove the data is
     enough — render also read S.from and S.to, the boxes at the top of the
     screen, which are empty when a saved plan is opened on a fresh start. So it
     threw, inside an async click handler that swallowed it, and the row looked
     dead. Rendering it here is the only check that would have caught that. */
  env.PACK_IN.fromName = 'Delhi';
  env.PACK_IN.toName   = 'Manali';
  env.PACK_IN.marks    = env.PACK_IN.marks.map(m => ({...m, eta: new Date()}));
  env.PACK_IN.cfg      = {...gcfg, trafficWhy: 'test'};
  env.PACK_IN.cal      = {eta:0.774, C:0.99, learn:1, vA:60, vB:60};
  env.PACK_IN.legs     = [{a:0, b:gs.length-1}];
  env.PACK_IN.itinerary= {rows:[], stopCount:0, totalMins:120, real:true};
  env.PACKED2 = evalIn('packPlan(PACK_IN, {from:"Delhi", to:"Manali", car:"Curvv",'
                     + ' stops:0, endPct:40, form:{}})');
  vm.runInContext('S.from = null; S.to = null;', env);      // as on a cold start
  let drew = '', threw = null;
  try {
    vm.runInContext('BACK2 = unpackPlan(PACKED2); render(BACK2);', env);
    drew = evalIn("$('out').innerHTML");
  } catch (e) { threw = e.message; }
  check('a saved plan renders with no form filled in', !threw, threw || '');
  check('and it names its own endpoints', /Delhi to Manali/.test(drew),
    (drew.match(/<div class="sub">[^<]{0,60}/) || ['nothing'])[0]);

  /* With a stop in it, which is the only kind of plan anyone saves. The check
     above passed on a plan with no stops at all, which is how it certified a
     build where every real saved plan threw the moment it was opened — the
     charger cards read s.list, and packing had dropped it to save four
     kilobytes. An empty fixture is not a small test, it is a different one. */
  const chg = (name) => ({ name, loc: gs[150].ll, kw:60, points:2, dc:true, plugs:['CCS2'],
    working:true, membership:false, verified:new Date(), src:'google', url:'x',
    rating:4.2, votes:60, free:1, conf:8, ageDays:3, pid:'p1',
    guns:[{plug:'CCS2', kw:60, count:2, free:1, dead:0}], detour:1.2, detourPct:0.4, idx:150 });
  const best = chg('Statiq'), alt1 = chg('Tata Power'), alt2 = chg('Zeon');
  env.PACK_IN.stops = [{ i:150, km:150, list:[best, alt1, alt2], best, arrive:60, target:90,
    need:30, detourPct:0.4, kWh:15, movedBack:0, radius:45, mode:'dc', hitKm:150,
    calls:3, minutes:20, after:45, kw:60, alt:null }];
  env.PACK_IN.itinerary = { stopCount:1, totalMins:260, real:true, rows:[
    { leg:1, fromName:'Delhi', fromKm:0, leave:100, driveKm:150, driveMins:120,
      toName:'Statiq', toKm:150, arrive:60, target:90, addKWh:15, addMins:20, kw:60,
      ll:gs[150].ll, chg:best.loc, detour:1.2, obj:best, stop:true },
    { leg:2, fromName:'Statiq', fromKm:150, leave:90, driveKm:150, driveMins:120,
      toName:'Manali', toKm:300, arrive:45 }]};
  env.PACKED3 = evalIn('packPlan(PACK_IN, {from:"Delhi", to:"Manali", car:"Curvv",'
                     + ' stops:1, endPct:45, form:{}})');
  let drew3 = '', threw3 = null;
  try {
    vm.runInContext('BACK3 = unpackPlan(PACKED3); render(BACK3);', env);
    drew3 = evalIn("$('out').innerHTML");
  } catch (e) { threw3 = e.message; }
  check('a saved plan with a charging stop opens', !threw3, threw3 || '');
  check('the stop it chose is still named', /Statiq/.test(drew3), 'the stop is gone');
  check('and the alternatives came back with it', /backup/.test(drew3), 'no backups kept');

  const src = fs.readFileSync(SRC, 'utf8');

  /* Contrast, computed from the stylesheet rather than eyeballed.

     ink3 carries most of the small print — mono captions, kpi labels, tags,
     inactive tabs — and was 2.84:1 on white, under even the 3:1 allowed for
     large text, at ten and eleven pixels. White on the brand green was 3.05,
     and that pair is the Plan button and the numbered chip on every card head.
     Neither was visible to anyone reading the code; both are arithmetic. */
  console.log('\n  contrast');
  console.log('  ' + '-'.repeat(55));
  const lum = h => {
    const c = [1,3,5].map(i => parseInt(h.substr(i,2),16)/255)
      .map(x => x <= 0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4));
    return 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
  };
  const contrast = (a,b) => { const x = lum(a), y = lum(b);
    return (Math.max(x,y)+0.05) / (Math.min(x,y)+0.05); };

  const themeBlock = (start) => {
    const i = src.indexOf(start); const j = src.indexOf('}', i);
    const out = {};
    for (const m of src.slice(i, j).matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g))
      out[m[1]] = m[2];
    return out;
  };
  const themes = { light: themeBlock(':root{'), dark: themeBlock(':root[data-theme=dark]{') };

  /* Small print is small print in both themes, so 4.5 applies to all of it. */
  for (const [name, t] of Object.entries(themes)) {
    for (const ground of ['sheet','paper']) {
      for (const fg of ['ink','ink2','ink3']) {
        const r = contrast(t[fg], t[ground]);
        check(`${name}: ${fg} on ${ground} is readable`, r >= 4.5,
          `${t[fg]} on ${t[ground]} is ${r.toFixed(2)}:1`);
      }
    }
    const warn = contrast(t.warn, t.sheet);
    check(`${name}: a warning is readable`, warn >= 4.5,
      `${t.warn} is ${warn.toFixed(2)}:1`);
  }

  /* The filled buttons: white on green in light, near-black on green in dark. */
  const btnLight = contrast('#FFFFFF', themes.light['brand-green']);
  const btnDark  = contrast('#08120E', themes.dark['brand-green']);
  console.log(`  the Plan button reads ${btnLight.toFixed(2)}:1 light, ${btnDark.toFixed(2)}:1 dark`);
  check('the Plan button carries its label in light', btnLight >= 4.5, `${btnLight.toFixed(2)}`);
  check('the Plan button carries its label in dark',  btnDark  >= 4.5, `${btnDark.toFixed(2)}`);
  const hover = contrast('#FFFFFF', themes.light['brand-blue']);
  check('and still does when hovered', hover >= 4.5, `${hover.toFixed(2)}`);

  /* The sheet has to survive being killed. It did not: whatever car you chose,
     the app came back a Tata Curvv with factory figures — which is a strange
     thing for an app whose whole premise is that it knows your car. Hand-edited
     specs went with it, and those are the ones nobody wants to type twice. */
  console.log('\n  the sheet between runs');
  console.log('  ' + '-'.repeat(55));
  const field = (id, v) => vm.runInContext(`$('${id}').value = ${JSON.stringify(v)}`, env);
  const read  = id => vm.runInContext(`$('${id}').value`, env);

  field('carpick','be6'); vm.runInContext('applyCar()', env);
  field('cap','71.5'); field('carname','BE 6, mine');   // as if edited by hand
  field('reserve','15'); field('arrive','35'); field('margin','5');
  await vm.runInContext('saveSheet()', env);

  /* everything back to how a fresh install looks */
  ['carpick','cap','carname','reserve','arrive','margin'].forEach(id=>field(id,''));
  field('carpick','curvv55'); vm.runInContext('applyCar()', env);
  check('the fixture really was reset', read('cap') !== '71.5', read('cap'));

  const found = await vm.runInContext('loadSheet()', env);
  check('a saved sheet is found on start-up', found === true, `${found}`);
  check('the car comes back', read('carpick') === 'be6', read('carpick'));
  check('a hand-edited capacity comes back', read('cap') === '71.5', read('cap'));
  check('a hand-edited name comes back', read('carname') === 'BE 6, mine', read('carname'));
  check('the floor and the arrival come back',
    read('reserve') === '15' && read('arrive') === '35', `${read('reserve')}/${read('arrive')}`);
  check('and the sliders follow their boxes',
    read('reserve_r') === '15' && read('arrive_r') === '35',
    `${read('reserve_r')}/${read('arrive_r')}`);

  /* And that it is called on the way in. The check above passes on a build
     where loadSheet is perfect and never runs, which is precisely the build
     that forgets your car — so the wiring is asserted separately from the
     function, source-level, because start-up is outside the sandbox. */
  check('the sheet is restored at start-up', /await loadSheet\(\)/.test(src), 'never called');
  check('and saved when a field changes',
    /addEventListener\('change', saveSheet\)/.test(src), 'nothing saves it');
  check('and when the car is changed', /paintCarSources\(\); saveSheet\(\)/.test(src),
    'the car picker does not save');

  /* The defaults a fresh install starts from, which are not the same question. */
  const num = id => (src.match(new RegExp(`id="${id}" value="([^"]+)"`)) || [])[1];
  console.log(`  fresh install starts at floor ${num('reserve')}%,`
            + ` arrive ${num('arrive')}%, margin ${num('margin')}%`);
  check('the floor default is 15', num('reserve') === '15', num('reserve'));
  check('the arrival default is 35', num('arrive') === '35', num('arrive'));
  check('the margin default is 5', num('margin') === '5', num('margin'));

  /* Two things that are invisible in a screenshot and obvious to a finger or a
     screen reader. Both were wrong in ways nobody reading the code would see. */
  const symbolOnly = [...src.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)]
    .filter(m => {
      const text = m[3].replace(/<[^>]+>/g, '').trim();
      /* A symbol is not a name. Words are — "On" reads fine once the group it
         sits in has a label, which is the separate check below. */
      return text && !/[a-z0-9]/i.test(text) && !/aria-label=/.test(m[2]);
    });
  check('every icon-only control says what it is',
    symbolOnly.length === 0,
    symbolOnly.map(m => m[3].trim()).join(' '));

  /* And a segmented On/Off announces what it is switching. */
  const segs = [...src.matchAll(/<div class="seg"([^>]*)id="([^"]+)"/g)];
  const unnamed = segs.filter(m => !/aria-label=/.test(m[1])).map(m => m[2]);
  check('every segmented control names what it switches', unnamed.length === 0,
    unnamed.join(', '));

  /* 44 px is roughly a fingertip. The delete crosses drew at 26 to 34, which
     looks right and misses on a phone, so each grew a reach past its mark. */
  for (const cls of ['tdel', 'hdel', 'chgpop .x']) {
    const re = new RegExp(`\\.${cls.replace(' ', '\\s')}::after\\{[^}]*width:44px[^}]*height:44px`);
    check(`the ${cls.replace('chgpop .x','card close')} reaches a fingertip`, re.test(src), 'still its own size');
  }

  /* Who made this, and on what terms — in the app, not only in the repository.
     The documents are markdown in git and are rendered into the page at build
     time, so what a phone shows and what the file says cannot drift. */
  console.log('\n  about, terms and copyright');
  console.log('  ' + '-'.repeat(55));
  for (const t of ['__TERMS_HTML__', '__PRIVACY_HTML__'])
    check(`the source holds ${t} rather than a copy of the text`, src.includes(t), 'inlined');
  check('the app names who made it', /© 2026 Saurabh Rathi/.test(src), 'no copyright line');
  check('and how to reach them', /sbh7435@gmail\.com/.test(src), 'no contact');
  check('terms and privacy are both reachable in Settings',
    /id="acc-terms"/.test(src) && /id="acc-privacy"/.test(src), 'one of them is missing');
  check('the repository states its terms', fs.existsSync(path.join(__dirname,'..','LICENSE')),
    'no LICENSE');

  const builtApp = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'index.html');
  if (fs.existsSync(builtApp)) {
    const b = fs.readFileSync(builtApp, 'utf8');
    check('the built app carries the terms in full',
      /Terms of Use — EVRoute/.test(b) && /No warranty/i.test(b), 'terms did not render');
    check('and the privacy policy in full',
      /Privacy Policy — EVRoute/.test(b), 'privacy did not render');
    check('with no placeholder left behind',
      !/__(TERMS|PRIVACY)_HTML__/.test(b), 'unrendered');
    /* Links to other markdown files are useful in git and dead on a phone. */
    const about = b.slice(b.indexOf('id="acc-terms"'), b.indexOf('id="acc-privacy"'));
    check('and no link that goes nowhere on a phone',
      !/href="[^"]*\.md/.test(about), 'a .md link survived');
    console.log(`  terms and privacy add ${(
      (b.match(/<div class="doc">[\s\S]*?<\/div>\s*<\/div>/g)||['']).join('').length/1024
    ).toFixed(1)} KB to the bundle`);
  }

  /* Consent before advertising. The app shipped the advertising ID and the
     Privacy Sandbox permissions and asked nobody — legal in India, not in the
     EEA, the UK, or a dozen American states. The platform that asks was inside
     play-services-ads all along and had never been called, so R8 was stripping
     it as dead code. These are source checks: the Kotlin is outside the
     sandbox, and the failure they guard is an ad served before the question. */
  const act = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'main',
    'java', 'com', 'routesection', 'evplanner', 'MainActivity.kt'), 'utf8');
  check('the consent platform is asked before anything else',
    /requestConsentInfoUpdate/.test(act), 'no consent request');
  check('and its form is shown when it is required',
    /loadAndShowConsentFormIfRequired/.test(act), 'the form is never shown');
  check('the ads SDK starts only once consent allows it',
    /if \(!consent\.canRequestAds\(\)\) return/.test(act), 'ads start regardless');
  /* Counted in the code, not in the prose about the code — the comment above
     the call names it too, which is the same trap the build-string lint fell
     into an hour ago. */
  const actCode = act.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('nothing else starts the ads SDK behind its back',
    (actCode.match(/MobileAds\.initialize/g) || []).length === 1, 'more than one path in');
  check('the choice can be reopened later',
    /showPrivacyOptionsForm/.test(act), 'no way back to the form');
  check('and without opening a JavaScript bridge to do it',
    !/@JavascriptInterface/.test(act) && /evroute" && url\.host == "privacy-options"/.test(act),
    'a bridge was added');
  check('the page only offers the choice where there is one',
    /window\.__privacyOptions/.test(src) && /id="privacy-options"[^>]*hidden/.test(src),
    'the button is always there');
  check('the policy says what the ads collect',
    /advertising ID/i.test(fs.readFileSync(path.join(__dirname,'..','PRIVACY.md'),'utf8')),
    'undisclosed');

  /* The tab list and the views have to agree, or a tab switches to nothing. */
  const tabs = (src.match(/const TABS = \[([^\]]+)\]/)||[])[1] || '';
  const names = tabs.split(',').map(t => t.trim().replace(/'/g, '')).filter(Boolean);
  const noView = names.filter(n => !src.includes(`id="v-${n}"`));
  console.log(`  tabs: ${names.join(', ')}`);
  check('every tab has a view behind it', noView.length === 0, noView.join(','));
  check('saved plans have a tab of their own', names.includes('plans'), tabs);

  /* And the card's life on the map, which is where the first version failed:
     it rendered correctly and then could never be got rid of. Opening, closing
     and re-opening are three things a specimen of the markup cannot check. */
  const mapbox = vm.runInContext("$('mapbox')", env);
  const SITE1 = { name:'A', loc:{lat:28.6,lng:77.2}, kw:60, dc:true, free:1, points:2,
                  guns:[{plug:'CCS2',kw:60,count:2,free:1}] };
  const cards = () => mapbox.querySelectorAll('.chgpop').length;

  env.showChgPop(SITE1);
  check('tapping a pin puts one card on the map', cards() === 1, `${cards()} cards`);
  env.showChgPop({...SITE1, name:'B', loc:{lat:29.1,lng:77.4}});
  check('tapping a second pin replaces it rather than stacking', cards() === 1, `${cards()} cards`);
  env.hideChgPop();
  check('closing the card removes it', cards() === 0, `${cards()} left`);
  env.showChgPop(SITE1); env.hideChgPop(); env.showChgPop(SITE1);
  check('it can be opened again after closing', cards() === 1, `${cards()} cards`);
  env.hideChgPop();
  console.log(`  open, replace, close, reopen — ${cards()} left on the map`);

  /* Every panel on the results page has to be reachable from the chips at the
     top, and the chips find heads with a selector. Folding the working panels
     put their heads a level deeper and they silently left the list — a bug
     with no error and no visual tell on the panel itself, only a shorter row
     of chips that nobody counts. So the panels are counted here instead:
     source-level, because afterRender lives outside the engine sandbox. */
  console.log('\n  the results page');
  console.log('  ' + '-'.repeat(55));
  const page = fs.readFileSync(SRC, 'utf8');
  const result = page.slice(page.indexOf("$('out').innerHTML=aliasBanner+`"),
                            page.indexOf('if(window.UI) UI.afterRender();'));
  const plainHeads = (result.match(/<div class="head">\s*<h2>/g)||[]).length;
  const foldHeads  = (result.match(/<summary class="head">\s*<h2>/g)||[]).length;
  const sel = (page.match(/const HEAD='([^']+)'/)||[])[1] || '';
  console.log(`  written inline in the template: ${plainHeads} open, ${foldHeads} folding`
              + ' (the rest come from functions)');
  console.log(`  chips look for: ${sel}`);
  check('the results page still folds some panels', foldHeads > 0, `${foldHeads}`);
  check('the chips look for plain heads', /:scope > \.head h2/.test(sel), sel);
  check('the chips look for folded heads too',
    /:scope > details > summary\.head h2/.test(sel), sel);
  check('a chip opens a folded panel before scrolling to it',
    /d\.open\s*=\s*true/.test(page), 'arrives at a shut panel');

  /* The version on the phone. It lived in the page as a typed string and said
     r53 for weeks across a dozen releases, so a bug report carried a number
     that meant nothing. It is a placeholder in the source now and gets filled
     from app/build.gradle.kts at build time — which only works if the source
     never carries a real version, and the build never leaves one unfilled. */
  const gradle = fs.readFileSync(path.join(__dirname, '..', 'app', 'build.gradle.kts'), 'utf8');
  const want = {
    __BUILD_VER__:  (gradle.match(/versionName\s*=\s*"([^"]+)"/)||[])[1],
    __BUILD_CODE__: (gradle.match(/versionCode\s*=\s*(\d+)/)||[])[1],
  };
  console.log(`  gradle says ${want.__BUILD_VER__} (${want.__BUILD_CODE__})`);
  for(const token of ['__BUILD_ID__','__BUILD_VER__','__BUILD_CODE__','__BUILD_DATE__'])
    check(`the source carries ${token} rather than a version`, page.includes(token), 'hard-coded');
  /* Two of these had been typed in by hand, in two different schemes, and both
     went stale silently — one said r53 for weeks, the other r22. The check has
     to ignore the comments that explain why, or it fails on its own epitaph. */
  const code = page.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check('nothing in the source claims a version of its own',
    !/20\d\d-\d\d-\d\d\s+r\d+/.test(code), (code.match(/20\d\d-\d\d-\d\d\s+r\d+/)||[])[0]);

  const built = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'index.html');
  if (fs.existsSync(built)) {
    const b = fs.readFileSync(built, 'utf8');
    check('the built bundle has no placeholder left',
      !/__BUILD_(ID|VER|CODE|DATE)__/.test(b), 'unstamped');
    check('the built bundle shows the version gradle was set to',
      b.includes(`id="s-ver">${want.__BUILD_VER__}<`)
      && b.includes(`id="s-code">${want.__BUILD_CODE__}<`),
      'the page and the store listing disagree');
  }

  /* "Now" used to blank the departure field. Empty and now mean the same thing
     to the planner, so nothing computed wrongly — but a button that empties a
     box reads as a button that failed. Two things have to hold: it writes a
     stamp, and the input's minimum sits behind the clock, or the value it just
     wrote is a minute stale by the time the form is submitted and the browser
     rejects it. */
  const nowBtn = page.slice(page.indexOf("$('depart-now').addEventListener"),
                            page.indexOf("$('depart-now').addEventListener") + 400);
  check('Now fills the field rather than clearing it',
    /value=localStamp\(new Date\(\)\)/.test(nowBtn) && !/value=''/.test(nowBtn), nowBtn.slice(0,120));
  check('the minimum leaves the clock some slack',
    /min=localStamp\(new Date\(now\.getTime\(\)-\d+\*60000\)\)/.test(page),
    'a stamped now goes invalid within the minute');
  /* The stamp has to be local wall-clock without a zone, which is the one
     format datetime-local accepts and the one toISOString does not give. */
  const stampFn = page.match(/const localStamp = ([\s\S]{0,220}?);\n/);
  check('the stamp is local, not UTC',
    !!stampFn && /getFullYear[\s\S]*getHours/.test(stampFn[1]) && !/toISOString/.test(stampFn[1]),
    stampFn ? stampFn[1].slice(0,90) : 'not found');

  /* Where the strategy can be changed, and where it cannot. The toggle sits on
     the Plan screen, so replanning from it lands on someone still filling in
     the form; the switch that acts belongs in the note that has just costed
     the alternative in minutes. Both halves are asserted because the wrong
     one was shipped, and it looked like a fix. */
  const stratHandler = page.slice(page.indexOf("$('strat-toggle').addEventListener"),
                                  page.indexOf("$('chg-toggle').addEventListener"));
  check('the plan-screen toggle does not start a plan',
    !/\bplan\(/.test(stratHandler), 'the toggle replans');
  check('the results page offers the switch instead',
    /data-strat="\$\{/.test(page), 'no switch on the results page');
  check('and that switch does replan',
    /closest\('button\[data-strat\]'\)[\s\S]{0,400}plan\(\{preventDefault/.test(page),
    'the switch changes nothing');

  /* The floor and the arrival target, which used to be one number.

     A driver who wants to arrive on 50% was telling the app it may never drop
     below 50% anywhere, which on a 52 kWh pack halves every leg. Both must now
     be honoured, and — this is the point of the change — raising only the
     arrival must not buy stops, because only the last leg pays for it. */
  console.log('\n  floor and arrival');
  console.log('  ' + '-'.repeat(55));
  vm.runInContext('CHG_CACHE.clear()', env);
  env.findChargers = async (centre) => AT
    .map(([km, kw, rating, bays]) => ({ name: `C@${km}`, loc: gs[km].ll, kw, points: bays,
      dc: true, plugs: ['CCS2'], working: true, membership: false,
      verified: new Date(), src: 't', url: '', rating, votes: 60 }))
    .filter(c => Math.hypot((c.loc.lat - centre.lat) * 111, (c.loc.lng - centre.lng) * 95) < 50);

  const legOf = (a, b) => gsim.socTrace[a] - gsim.socTrace[b];
  const walk = async (floor, arrive) => {
    const p = (await env.planStops(gsim, gs, floor, '', gcfg, null, arrive)).filter(x => !x.none);
    let soc = 100, at = 0, low = 100;
    for (const s of p) { const a = soc - legOf(at, s.i); low = Math.min(low, a); soc = Math.max(a, s.target); at = s.i; }
    const end = soc - legOf(at, gs.length - 1);
    return { n: p.length, low: Math.min(low, end), end, km: p.map(x => Math.round(x.km)) };
  };

  const both  = await walk(15, 50);
  const oneNo = await walk(50, 50);
  const plain = await walk(15, 15);
  const high  = await walk(15, 70);
  console.log(`  floor 15 arrive 50 -> ${both.n} stops [${both.km}] low ${both.low.toFixed(0)}% end ${both.end.toFixed(0)}%`);
  console.log(`  floor 50 arrive 50 -> ${oneNo.n} stops [${oneNo.km}] low ${oneNo.low.toFixed(0)}% end ${oneNo.end.toFixed(0)}%`);
  console.log(`  floor 15 arrive 70 -> ${high.n} stops [${high.km}] low ${high.low.toFixed(0)}% end ${high.end.toFixed(0)}%`);

  check('the arrival target is met', both.end >= 50 - 1, `${both.end.toFixed(1)}%`);
  check('the floor is held all the way', both.low >= 15 - 0.5, `dipped to ${both.low.toFixed(1)}%`);
  check('a high arrival does not raise the floor', both.low < 50 - 1,
    `never went below ${both.low.toFixed(1)}%, so the floor moved with it`);
  /* The claim worth holding is not that a fuller arrival is free — on a sparse
     corridor it can cost a stop, and it does here, 2 to 3. It is that it costs
     somewhere between nothing and what raising the floor would have cost, and
     on this route that is 3 against 4. The stronger version was asserted first
     and the test caught it, which is the only reason the hint in the app does
     not still promise it. */
  check('a fuller arrival never costs more than raising the floor would',
    both.n <= oneNo.n, `${both.n} vs ${oneNo.n}`);
  check('and never costs less than not asking for it',
    both.n >= plain.n, `${both.n} vs ${plain.n}`);
  check('asking for more at the door is worth something here',
    both.n < oneNo.n, `${both.n} vs ${oneNo.n} — no saving to show`);
  check('a much fuller arrival is still met', high.end >= 70 - 1, `${high.end.toFixed(1)}%`);
  /* Arriving on less than the floor is not a thing that can be asked for. */
  const under = await walk(30, 10);
  check('an arrival below the floor is treated as the floor', under.end >= 30 - 1,
    `${under.end.toFixed(1)}% against a 30% floor`);

  /* The taper is the whole reason the two strategies can differ, so if it ever
     flattens the choice becomes cosmetic. The last tenth of a pack must cost
     appreciably more than the first. */
  const tp = (a, b) => env.chargeCurveMinutes(a, b, 52, 60);
  check('the last tenth of the pack costs more than the first',
    tp(90, 100) > tp(30, 40) * 3, `${tp(90,100).toFixed(1)} vs ${tp(30,40).toFixed(1)} min`);

  console.log('\n  ' + '-'.repeat(55));
  console.log(`  ${pass} passed, ${fail} failed\n`);
  if (bad.length) { bad.forEach(b => console.log('  FAIL ' + b)); console.log(); }
  process.exit(fail ? 1 : 0);
}

if (require.main === module) main();
module.exports = { loadEngine, drive, flat, climbTo, rolling, overPass, weatherFor };
