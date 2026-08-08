/* The shared cache, and the reason this service is worth running.
 *
 * On the device a charger cache can only ever help its owner. Here it helps
 * everybody, and routes repeat: Delhi to Manali is the same road for whoever
 * drives it. The second person to plan a popular corridor pays nothing.
 *
 * Two lives, not one. A charger's location is good for hours; how many guns are
 * free is good for minutes, and it is the number the app prints in bold. The
 * device cache kept both for six hours, which meant a card could say "2 of 4
 * free" about this morning. Split here, from a single upstream response:
 *
 *   chg:<cell>   the sites in a circle, without availability   6 hours
 *   av:<pid>     one site's free-gun count                    15 minutes
 *
 * So a six-hour-old circle still answers with fresh counts if anyone has asked
 * about those chargers in the last quarter of an hour, and only the sites
 * nobody has asked about go back upstream.
 */

export const SITE_TTL = 6 * 3600;      // seconds
export const AVAIL_TTL = 15 * 60;

/* Circles are keyed on a snapped centre so that two drivers on the same road
 * land on the same entry.
 *
 * The first version rounded to three decimals — about 110 m — on the theory
 * that samples of the same road are close together. They are, and it still
 * missed: two points twenty metres apart share a cell only if no boundary runs
 * between them, and with boundaries every 110 m that is a coin toss. Fine
 * rounding does not make sharing likely, it makes the boundaries dense.
 *
 * The grid is tied to the radius instead: an eighth of it, so a 45 km sweep
 * snaps to about 5.6 km. Boundaries are now rare enough that samples of one
 * road nearly always agree, and when they do not the two circles still overlap
 * by more than ninety per cent — so the miss costs one fetch, not a wrong
 * answer. */
const snap = (v, step) => Math.round(v / step) * step;

export function cell(lat, lng, radiusKm) {
  const step = Math.max(0.01, radiusKm / 8 / 111);      // degrees
  return `${snap(lat, step).toFixed(4)},${snap(lng, step).toFixed(4)},${Math.round(radiusKm)}`;
}

const avKey = pid => `av:${pid}`;

/** The availability fields, split off a charger so the rest can outlive them. */
const availabilityOf = c => ({
  free: c.free, dead: c.dead, guns: c.guns, liveAt: c.liveAt, openNow: c.openNow,
});

const withoutAvailability = c => {
  const { free, dead, guns, liveAt, openNow, ...rest } = c;
  return rest;
};

export async function readCircle(kv, key) {
  const hit = await kv.get(`chg:${key}`, 'json');
  if (!hit) return null;

  /* Sites are cached without their counts; the counts are fetched back one by
   * one, and any that have expired come back null — which the client already
   * knows how to draw as "nobody reports this one" rather than as "empty". */
  const sites = await Promise.all(hit.sites.map(async site => {
    if (!site.pid) return { ...site, free: null, dead: 0, guns: [], liveAt: null };
    const av = await kv.get(avKey(site.pid), 'json');
    return av ? { ...site, ...av }
              : { ...site, free: null, dead: 0, guns: site.guns || [], liveAt: null };
  }));

  return { sites, at: hit.at, fresh: false };
}

export async function writeCircle(kv, key, chargers) {
  const now = Date.now();
  await kv.put(
    `chg:${key}`,
    JSON.stringify({ at: now, sites: chargers.map(withoutAvailability) }),
    { expirationTtl: SITE_TTL },
  );
  /* Availability is written per site rather than per circle, so a charger that
   * appears in three overlapping circles is stored once and refreshed once. */
  await Promise.all(chargers
    .filter(c => c.pid)
    .map(c => kv.put(avKey(c.pid), JSON.stringify(availabilityOf(c)),
                     { expirationTtl: AVAIL_TTL })));
}

export async function readAvailability(kv, pid) {
  return kv.get(avKey(pid), 'json');
}

export async function writeAvailability(kv, pid, ev) {
  await kv.put(avKey(pid), JSON.stringify({
    free: ev.free, dead: ev.dead, guns: ev.guns, liveAt: ev.liveAt,
  }), { expirationTtl: AVAIL_TTL });
}

/* Routes are worth caching too, and for far longer: the road between two towns
 * does not move. Only the traffic estimate goes stale, and that is only asked
 * for when a departure time is given — those are not cached at all. */
export const ROUTE_TTL = 7 * 24 * 3600;

export const routeKey = (from, to) =>
  `rt:${from.lat.toFixed(4)},${from.lng.toFixed(4)}-${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;
