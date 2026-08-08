/* The drive log, pooled.
 *
 * Every plan the app makes is a prediction, and every drive that follows is the
 * answer to it. Today that answer stays on the phone that produced it: the
 * owner's model gets better and nobody else's does. `../data/validation.md`
 * records what that costs — the whole model is anchored on two reference drives
 * taken off the internet rather than measured, `eta` sits at 77.4% where four
 * independent cars imply 84-89%, and there is no way to settle it from the
 * armchair.
 *
 * This endpoint is how it gets settled. Not by scraping more magazine range
 * tests, which is the same afternoon's data borrowed again, but by many real
 * drives across seasons, cars and roads, each with its conditions recorded.
 *
 * What it accepts is deliberately thin. There is no identity, no account, no
 * route, and no coordinates — a start and a destination are the two things
 * about a journey that identify a person, and they are exactly what the physics
 * does not need. What is left is a car, a distance, a climb, a temperature and
 * two percentages, which is everything required to say whether the model was
 * right and nothing else.
 */

import { text } from './limits.js';

const CARS = /^[a-z0-9]{2,16}$/;

function num(v, name, lo, hi) {
  const n = Number(v);
  if (!isFinite(n) || n < lo || n > hi) {
    const e = new Error(`${name} must be between ${lo} and ${hi}`);
    e.status = 400;
    throw e;
  }
  return n;
}

export function readTrip(body) {
  const car = text(body.car, 'car', 16);
  if (!CARS.test(car)) {
    const e = new Error('car must be a key from the app\'s own list');
    e.status = 400;
    throw e;
  }
  return {
    /* rounded on the way in: a drive of 312.4 km and one of 312.6 km are the
       same observation, and the extra digit is only ever identifying */
    car,
    year: body.year ? num(body.year, 'year', 2010, 2035) : null,
    km: Math.round(num(body.km, 'km', 1, 3000)),
    climb: Math.round(num(body.climb || 0, 'climb', -10000, 10000)),
    tempC: Math.round(num(body.tempC, 'tempC', -30, 60)),
    kmh: body.kmh ? Math.round(num(body.kmh, 'kmh', 5, 160)) : null,
    people: body.people ? num(body.people, 'people', 1, 9) : null,
    acPct: body.acPct != null ? Math.round(num(body.acPct, 'acPct', 0, 100) / 10) * 10 : null,
    /* Charge used, not charge remaining — so a drive with a stop in it spends
       more than a pack. Capped at 100 in the first version, which quietly threw
       away exactly the long mountain drives the model is worst at and most
       needs to hear about. Four full packs is the ceiling now. */
    predictedPct: Math.round(num(body.predictedPct, 'predictedPct', 0.1, 400) * 10) / 10,
    actualPct: Math.round(num(body.actualPct, 'actualPct', 0.1, 400) * 10) / 10,
    /* the app's own build, so a change in the physics can be told apart from a
       change in the weather when the numbers move */
    build: body.build ? text(body.build, 'build', 20) : null,
    at: Date.now(),
  };
}

/** One record per key, keyed on nothing that identifies anyone. */
export async function store(kv, trip) {
  const id = crypto.randomUUID();
  await kv.put(`trip:${trip.at}:${id}`, JSON.stringify(trip));
  return id;
}

/* What the pool says so far. Not an analysis — an invitation to do one, and a
 * way to see whether enough has arrived to be worth the effort. */
export async function summary(kv, limit = 1000) {
  const list = await kv.list({ prefix: 'trip:', limit });
  const rows = await Promise.all(list.keys.map(k => kv.get(k.name, 'json')));
  const trips = rows.filter(Boolean);
  if (!trips.length) return { trips: 0 };

  const err = trips.map(t => t.actualPct / t.predictedPct - 1);
  err.sort((a, b) => a - b);
  const median = err[err.length >> 1];
  const cars = {};
  for (const t of trips) cars[t.car] = (cars[t.car] || 0) + 1;

  return {
    trips: trips.length,
    cars: Object.keys(cars).length,
    /* Positive means drivers use more than the model predicts, which is the
       direction that strands people, and the direction validation.md expects
       to be wrong about. */
    medianError: Math.round(median * 1000) / 10,
    worst: Math.round(err[err.length - 1] * 1000) / 10,
    best: Math.round(err[0] * 1000) / 10,
    byCar: cars,
  };
}
