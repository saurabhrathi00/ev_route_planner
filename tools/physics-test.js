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

const SRC = path.join(__dirname, '..', 'web', 'index.html');

/* ---- the stub DOM ------------------------------------------------------ */
const FIELDS = {};                       // id -> value, set per scenario
function makeEl(id) {
  const el = {
    id,
    style: { setProperty(){}, cssText:'' },
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    dataset: {},
    children: [], hidden: false, disabled: false, textContent: '', innerHTML: '',
    get value() { return FIELDS[id] !== undefined ? String(FIELDS[id]) : ''; },
    set value(v) { FIELDS[id] = v; },
    addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){},
    querySelector(){ return makeEl('q'); }, querySelectorAll(){ return []; },
    closest(){ return null; }, getBoundingClientRect(){ return {width:0,height:0,left:0,top:0}; },
    setAttribute(){}, getAttribute(){ return null; }, focus(){}, blur(){},
    scrollTo(){}, scrollIntoView(){}, insertAdjacentHTML(){}, cloneNode(){ return makeEl(id); },
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
    addEventListener(){}, createElement: () => makeEl('new'),
    documentElement: makeEl('html'), head: makeEl('head'), body: makeEl('body'),
  };
  const sandbox = {
    document, console,
    window: { matchMedia: () => ({ matches:false, addEventListener(){} }), addEventListener(){} },
    localStorage: { getItem: () => null, setItem(){}, removeItem(){}, length:0 },
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

function main() {
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

  console.log('\n  ' + '-'.repeat(55));
  console.log(`  ${pass} passed, ${fail} failed\n`);
  if (bad.length) { bad.forEach(b => console.log('  FAIL ' + b)); console.log(); }
  process.exit(fail ? 1 : 0);
}

if (require.main === module) main();
module.exports = { loadEngine, drive, flat, climbTo, rolling, overPass, weatherFor };
