/* Is the key we are about to bundle actually harmless?
 *
 * With the backend live, exactly one key still ships inside the APK: the one
 * the map library uses, because that library runs on the phone and talks to
 * Google itself. It will be extracted — that is not preventable and not the
 * point. The point is that when it is, it can only draw maps.
 *
 * "Restricted to Maps JavaScript API" is a box ticked in a console three clicks
 * deep, on a page that also lists forty other APIs, and nobody can remember a
 * week later whether they ticked it. So this asks Google instead: it takes the
 * key from secrets.env and tries to use it for the two things it must not be
 * able to do. A refusal is a pass.
 *
 *   node tools/check-keys.js
 *
 * Nothing secret is printed. The key is never echoed, only its last six
 * characters, which is enough to tell two keys apart and not enough to use.
 */

const fs = require('fs');
const path = require('path');

const env = {};
for (const line of fs.readFileSync(path.join(__dirname, '..', 'secrets.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const key = env.GOOGLE_MAPS_KEY;
const proxy = env.PROXY_URL;
const tail = k => '…' + String(k).slice(-6);

let pass = 0, fail = 0;
const check = (what, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : 'FAIL'} ${what}${ok || !detail ? '' : ' — ' + detail}`);
  ok ? pass++ : fail++;
};

/* Google refuses a restricted key with 403 and a message naming the API. A 200
 * means the key did the thing it was supposed to be unable to do. */
async function refused(what, url, init) {
  const r = await fetch(url, init);
  const body = await r.text();
  const blocked = r.status === 403 || /API_KEY_SERVICE_BLOCKED|not authorized|PERMISSION_DENIED/i.test(body);
  check(`the bundled key cannot ${what}`, blocked,
    `HTTP ${r.status} — this key can still ${what}, so extracting it from the APK is worth doing`);
}

(async () => {
  console.log('\n  the key that ships inside the app');
  console.log('  ' + '-'.repeat(56));

  if (!key) {
    console.log('  no GOOGLE_MAPS_KEY in secrets.env — nothing is bundled, nothing to check\n');
    process.exit(0);
  }
  console.log(`  key ${tail(key)}${proxy ? `, backend at ${proxy.replace(/^https:\/\//, '')}` : ', no backend'}`);

  if (!proxy) {
    console.log('\n  No PROXY_URL, so this build calls Google directly and the bundled key');
    console.log('  has to be able to do everything. There is nothing to restrict yet —');
    console.log('  deploy the backend first.\n');
    process.exit(0);
  }

  await refused('look up chargers', 'https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id',
    },
    body: JSON.stringify({
      includedPrimaryTypes: ['electric_vehicle_charging_station'],
      maxResultCount: 1,
      locationRestriction: { circle: { center: { latitude: 28.6, longitude: 77.2 }, radius: 1000 } },
    }),
  });

  await refused('plan routes', 'https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.distanceMeters',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: 28.6, longitude: 77.2 } } },
      destination: { location: { latLng: { latitude: 28.7, longitude: 77.3 } } },
      travelMode: 'DRIVE',
    }),
  });

  /* And the one thing it must still be able to do, or the map goes blank and
   * the app quietly falls back to OpenStreetMap tiles on every phone. */
  const r = await fetch(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=marker`);
  const js = await r.text();
  check('but it can still draw the map', r.ok && !/ApiNotActivatedMapError|InvalidKeyMapError|RefererNotAllowed/.test(js),
    (js.match(/[A-Za-z]+MapError/) || ['unknown refusal'])[0]);

  console.log('  ' + '-'.repeat(56));
  console.log(`  ${pass} passed, ${fail} failed\n`);
  if (fail) {
    console.log('  Fix in Cloud Console → Credentials → this key → API restrictions:');
    console.log('  Restrict key, and tick Maps JavaScript API only.\n');
  }
  process.exit(fail ? 1 : 0);
})();
