/* Every call this service makes to Google, and the shapes it turns them into.
 *
 * The field masks are the price list. Places (New) bills per request on the
 * heaviest field asked for, so an unused field in a mask is money spent on
 * something thrown away — `displayName` on a Place Details call once priced the
 * whole thing at Pro rather than Essentials, for a string the caller discarded.
 * Nothing is asked for here that the client does not use.
 *
 * The one deliberate exception is `evChargeOptions`. It is the reason the app
 * exists: nobody else reports live free-bay counts, and it must never be
 * trimmed to save money. Cost comes out of making fewer calls, not worse ones.
 */

const PLACES = 'https://places.googleapis.com/v1';
const ROUTES = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/* The charger mask, in full. `id` costs nothing and is what lets a single site
 * be asked about again later without sweeping the corridor a second time. */
const CHARGER_MASK = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.formattedAddress',
  'places.googleMapsUri',
  'places.evChargeOptions',
  'places.currentOpeningHours.openNow',
].join(',');

const PLUG = {
  EV_CONNECTOR_TYPE_CCS_COMBO_1: 'CCS1', EV_CONNECTOR_TYPE_CCS_COMBO_2: 'CCS2',
  EV_CONNECTOR_TYPE_CHADEMO: 'CHAdeMO', EV_CONNECTOR_TYPE_J1772: 'J1772',
  EV_CONNECTOR_TYPE_TYPE_2: 'Type 2', EV_CONNECTOR_TYPE_TESLA: 'Tesla',
  EV_CONNECTOR_TYPE_UNSPECIFIED_GB_T: 'GB/T', EV_CONNECTOR_TYPE_OTHER: 'other',
};

/* A gun is DC if it says so or if it is fast enough that it could not be
 * anything else. AC has no business in a route plan — 7 kW adds about 40 km in
 * an hour, which is an overnight rather than a stop — so it is excluded from
 * the counts rather than penalised in them. */
const isDC = a => /CCS|CHADEMO|TESLA/i.test(a.type || '') || (a.maxChargeRateKw || 0) >= 25;

export function readEV(evOpts) {
  const ev = evOpts || {};
  const agg = ev.connectorAggregation || [];
  const kw = Math.max(0, ...agg.map(a => a.maxChargeRateKw || 0));
  const dcAgg = agg.filter(isDC);
  const gun = dcAgg.length ? dcAgg : agg;

  /* A gun out of service is not a gun: a three-gun site with one dead is a
   * two-gun site, and counting it as three is how a driver arrives to find a
   * queue. */
  const dead = gun.reduce((n, c) => n + (c.outOfServiceCount || 0), 0);
  const free = gun.reduce((n, c) => n + (c.availableCount != null ? c.availableCount : 0), 0);
  const known = gun.some(c => c.availableCount != null);

  /* Google says when it last heard from the network. That is the age that
   * matters — a cache entry can be a minute old and carry a count from this
   * morning — and it is what lets availability be cached separately below. */
  const stamp = gun.map(c => c.availabilityLastUpdateTime).filter(Boolean).sort().pop();
  const types = [...new Set(agg.map(a => a.type).filter(Boolean))];

  return {
    kw,
    points: (dcAgg.length ? dcAgg.reduce((n, c) => n + (c.count || 0), 0) : 0)
            || ev.connectorCount || agg.reduce((n, c) => n + (c.count || 0), 0) || 1,
    plugs: types.map(t => PLUG[t] || t.replace('EV_CONNECTOR_TYPE_', '')),
    dc: kw >= 25 || types.some(t => /CCS|CHADEMO|TESLA/i.test(t)),
    free: known ? free : null,
    dead,
    liveAt: stamp ? Date.parse(stamp) : null,
    guns: gun.map(a => ({
      plug: PLUG[a.type] || String(a.type || '').replace('EV_CONNECTOR_TYPE_', ''),
      kw: a.maxChargeRateKw || 0,
      count: a.count || 1,
      dead: a.outOfServiceCount || 0,
      free: a.availableCount != null ? a.availableCount : null,
    })),
  };
}

const charger = p => ({
  ...readEV(p.evChargeOptions),
  pid: p.id || null,
  name: (p.displayName && p.displayName.text) || 'Charging station',
  loc: { lat: p.location.latitude, lng: p.location.longitude },
  addr: p.formattedAddress,
  rating: p.rating,
  votes: p.userRatingCount || 0,
  openNow: p.currentOpeningHours ? p.currentOpeningHours.openNow : undefined,
  url: p.googleMapsUri,
  src: 'google',
});

async function ask(url, init, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/* Upstream failures are logged whole and reported as a bare status. Google's
 * messages quote the project number and the quota that ran out, and a client
 * has no use for either — the app used to print them to drivers. */
async function unwrap(r, what) {
  if (r.ok) return r.json();
  let detail = '';
  try { detail = JSON.stringify(await r.json()).slice(0, 400); } catch { /* body was not json */ }
  console.warn(`upstream ${what} ${r.status} ${detail}`);
  const e = new Error(`${what} failed`);
  e.status = r.status === 429 ? 429 : 502;
  throw e;
}

export async function nearby(key, centre, radiusKm) {
  const r = await ask(`${PLACES}/places:searchNearby`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': CHARGER_MASK,
    },
    body: JSON.stringify({
      includedPrimaryTypes: ['electric_vehicle_charging_station'],
      maxResultCount: 20,
      /* Nearest first. Twenty is the ceiling Nearby returns, and a wide circle
       * over a city will hit it — ranked by prominence those twenty can all be
       * across town; ranked by distance they are the twenty closest to this
       * point on the road, which is the only ordering that makes widening a
       * corridor sweep safe. */
      rankPreference: 'DISTANCE',
      locationRestriction: {
        circle: {
          center: { latitude: centre.lat, longitude: centre.lng },
          radius: Math.min(50000, radiusKm * 1000),
        },
      },
    }),
  });
  const j = await unwrap(r, 'nearby');
  return (j.places || []).map(charger);
}

export async function placeEV(key, id) {
  const r = await ask(`${PLACES}/places/${encodeURIComponent(id)}`, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'evChargeOptions' },
  });
  return readEV((await unwrap(r, 'place')).evChargeOptions);
}

export async function autocomplete(key, input, session, bias) {
  const body = { input };
  if (session) body.sessionToken = session;
  if (bias) {
    body.locationBias = {
      circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 50000 },
    };
  }
  const r = await ask(`${PLACES}/places:autocomplete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
    body: JSON.stringify(body),
  });
  const j = await unwrap(r, 'autocomplete');
  /* Split into the bold line and the grey one, because that is how the menu
     draws it. Returning the joined string alone — which this did first — left
     the client with nothing to bold and, worse, called the id `id` where the
     app looks for `placeId`, so a tapped suggestion resolved to nothing. */
  return (j.suggestions || [])
    .filter(s => s.placePrediction)
    .map(s => {
      const p = s.placePrediction;
      const f = p.structuredFormat || {};
      const main = (f.mainText && f.mainText.text) || (p.text && p.text.text) || '';
      const sec = (f.secondaryText && f.secondaryText.text) || '';
      return { placeId: p.placeId, main, sec, name: [main, sec].filter(Boolean).join(', ') };
    });
}

/* Coordinates only. The caller already has the name — it came back with the
 * prediction they tapped — and displayName is a Pro field, which would price
 * the whole call at Pro for a string thrown away on arrival. */
export async function placeLocation(key, id, session) {
  const q = session ? `?sessionToken=${encodeURIComponent(session)}` : '';
  const r = await ask(`${PLACES}/places/${encodeURIComponent(id)}${q}`, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'location' },
  });
  const j = await unwrap(r, 'place location');
  if (!j.location) { const e = new Error('no coordinates'); e.status = 404; throw e; }
  return { lat: j.location.latitude, lng: j.location.longitude };
}

export async function searchText(key, query, bias) {
  const body = { textQuery: query, maxResultCount: 5 };
  if (bias) {
    body.locationBias = {
      circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 50000 },
    };
  }
  const r = await ask(`${PLACES}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.location,places.formattedAddress',
    },
    body: JSON.stringify(body),
  });
  const j = await unwrap(r, 'searchText');
  return (j.places || []).map(p => ({
    name: (p.displayName && p.displayName.text) || p.formattedAddress || query,
    loc: { lat: p.location.latitude, lng: p.location.longitude },
    addr: p.formattedAddress,
  }));
}

/* One SKU per request, and the heaviest field decides which.
 *
 * The mask is the app's, verbatim. The simulation walks the road step by step —
 * each step's own polyline and its *static* duration, so the speed it assumes
 * comes from an empty road and a jam is never counted twice. Traffic enters
 * once, as the ratio between the two totals. Returning a single overall
 * polyline instead, which is what this did first, throws away the per-step
 * speeds the physics is built on.
 *
 * `duration` and `staticDuration` are strings like "32400s". Parsed here so the
 * client never has to know that. */
const secs = t => parseFloat(String(t || '0s').replace('s', '')) || 0;

export async function route(key, from, to, departAt) {
  const traffic = departAt && new Date(departAt).getTime() > Date.now() + 60000;
  const r = await ask(ROUTES, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.staticDuration,'
        + 'routes.legs.steps.polyline.encodedPolyline,routes.legs.steps.distanceMeters,'
        + 'routes.legs.steps.staticDuration',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      ...(traffic ? { departureTime: new Date(departAt).toISOString() } : {}),
      polylineQuality: 'HIGH_QUALITY',
      computeAlternativeRoutes: false,
    }),
  }, 20000);
  const j = await unwrap(r, 'route');
  const best = (j.routes || [])[0];
  if (!best) { const e = new Error('no route'); e.status = 404; throw e; }

  const steps = [];
  (best.legs || []).forEach(leg => (leg.steps || []).forEach(st => {
    const enc = st.polyline && st.polyline.encodedPolyline;
    if (enc) {
      steps.push({
        polyline: enc,
        distance: st.distanceMeters || 0,
        duration: secs(st.staticDuration),
      });
    }
  }));
  if (!steps.length) { const e = new Error('route came back without a shape'); e.status = 502; throw e; }

  return {
    distance: best.distanceMeters || 0,
    steps,
    seconds: secs(best.duration),
    quietSeconds: best.staticDuration ? secs(best.staticDuration) : null,
  };
}

/* The same road at 3am, for the traffic ratio's divisor. A second Compute
 * Routes call on every plan, for a number that does not change from one hour to
 * the next — so it is cached hard, and asks for the duration alone. */
export async function quietDuration(key, from, to, whenISO) {
  const r = await ask(ROUTES, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.duration',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      departureTime: whenISO,
      computeAlternativeRoutes: false,
    }),
  }, 15000);
  const j = await unwrap(r, 'quiet route');
  const best = (j.routes || [])[0];
  return best ? secs(best.duration) : null;
}
