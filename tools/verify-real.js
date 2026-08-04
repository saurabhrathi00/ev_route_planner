#!/usr/bin/env node
/* Runs the shipped engine against published highway range tests.
 *
 *     node tools/verify-real.js
 *
 * The per-car corrections in CARS were fitted to Autocar India's *combined*
 * figures. These are their *highway* ones — the same cars and method, but a
 * different part of the data, and a different speed regime. A single scalar
 * cannot tell rolling resistance from drag, so the question this answers is
 * whether one fitted at a mixed speed still holds at a steady 85, or whether
 * it only ever fitted the average.
 */
const { loadEngine, drive, flat, weatherFor } = require('./physics-test.js');

/* usable kWh, kerb, cdA and k as shipped; measured highway range in km */
const CARS = [
  ['Tata Curvv EV 55',  52.0, 1650, 0.72, 1.19, 359],
  ['Tata Nexon EV 45',  40.5, 1550, 0.78, 0.93, 345],
  ['MG Windsor EV',     37.9, 1550, 0.80, 0.99, 289],
];
const HWY_KMH = 85;          // Autocar hold a steady highway loop; 85 is the usual figure
const TEMP    = 28;
const AC_PCT  = 60;

const env = loadEngine();
console.log(`\n  Highway range, model vs measured — steady ${HWY_KMH} km/h, ${TEMP} C\n`);
console.log(`  ${'car'.padEnd(20)}${'measured'.padStart(10)}${'model'.padStart(9)}${'error'.padStart(9)}`);
console.log('  ' + '-'.repeat(48));

let worst = 0;
for (const [name, cap, kerb, cdA, k, measured] of CARS) {
  /* Long enough that the pack runs out inside the drive, then read the
     distance at which it does — the same thing the test measures. */
  const km = 700;
  const { samples, elev } = drive({ km, profile: flat(200), spd: HWY_KMH });
  const marks = weatherFor(samples, TEMP, 0);
  const cfg = {
    cap, kerb, people: 1, bags: 20, acPct: AC_PCT,
    cdA: cdA * k, crr: 0.0095 * k, soh: 100,
    style: 1, styleKey: 'normal', vhwy: 200, vroad: 200,
    regen: 0.65, regenKW: 60, dckw: 100,
    trafficRatio: 1, smoothWin: 1, step: 1000,
  };
  const sim = env.simulate({ samples, elev, marks, cal: { eta: 0.774, C: 0.990, learn: 1 }, cfg, startPct: 100 });
  const i = sim.socTrace.findIndex(p => p <= 0);
  const range = i < 0 ? km : i;
  const err = (range / measured - 1) * 100;
  if (Math.abs(err) > Math.abs(worst)) worst = err;
  console.log(`  ${name.padEnd(20)}${(measured + ' km').padStart(10)}${(range + ' km').padStart(9)}${(err >= 0 ? '+' : '') + err.toFixed(1) + '%'}`.padEnd(4));
}
console.log('  ' + '-'.repeat(48));
console.log(`  worst error ${worst >= 0 ? '+' : ''}${worst.toFixed(1)}%\n`);
