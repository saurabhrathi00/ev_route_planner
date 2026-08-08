# Safar backend

A Cloudflare Worker that holds the Google API key, so the app stops carrying it.

Nothing here is deployed. The app on `main` still calls Google directly with a
bundled key; this branch is the thing that replaces that when it is worth doing.
`../backlog.md` says when.

    cd backend
    npm install          # wrangler only
    npm test             # runs against a stub upstream, no network, no key
    npm run dev          # local, needs secrets
    npm run deploy       # needs a Cloudflare account

---

## What it is for, in order of how much it matters

**1. The key comes off the device.** Today it ships inside every APK and every
copy of the web build, and it cannot be restricted: Google's Android app
restriction only covers calls made through the Maps SDK, which sign the request,
and Safar calls the REST APIs with `fetch()` from a WebView. A `file://` origin
sends no referrer either, so referrer restriction is out. Per-API restrictions
and a daily quota cap are the whole defence, and the cap protects the bill
rather than the users — a stolen key being hammered burns the day's quota and
the app stops working for everyone, indistinguishably from success.

**2. One driver's corridor sweep serves the next.** The expensive call is
Nearby Search along a route, and routes repeat: Delhi to Manali is the same
road for everyone who drives it. On the device that cache can only ever help
its owner. Here it helps everybody, and the second person to plan a popular
route costs nothing.

**3. Availability stops being a lie.** The device cache keeps a charger for six
hours because that is right for a location. It is wrong for a free-bay count,
which is the number the app prints in bold. Split here: locations for six hours,
availability for fifteen minutes, from one upstream response.

**4. The trip log becomes a dataset.** `POST /trip` accepts an anonymous record
of what a drive was predicted to cost and what it actually cost. That is the
only thing that will settle whether `eta` is 77.4% or nearer 88% — see
`../data/validation.md`. It is opt-in, it carries no identity, and it is the
reason the proxy is worth more than the money it saves.

---

## What it cannot fix

**The Maps JavaScript API key stays in the browser.** It has to: the library
runs on the device and talks to Google itself. Proxying the script tag would
hide nothing.

So there are two keys.

| Key | Where it lives | Restricted to | If it leaks |
|-----|----------------|---------------|-------------|
| `GOOGLE_KEY` | Worker secret | Places API (New), Routes API | it does not |
| Maps JS key | in the app, as today | **Maps JavaScript API only** | someone draws maps |

Splitting them is the point. The exposed one can do nothing but render tiles,
and it gets its own small quota. Set this up in Cloud Console before deploying —
`API restrictions → Restrict key → Maps JavaScript API`, nothing else ticked.

---

## Endpoints

Everything takes and returns JSON. Errors are `{error: "..."}` with a sensible
status, and never carry an upstream message — Google's errors quote project
numbers and quota internals, which is not something to hand to a client.

    GET  /health                     → {ok, version, upstream}
    GET  /config                     → what the client may use, and cache ages
    POST /nearby     {lat,lng,radiusKm}
    GET  /place/:id                  → one charger, live
    POST /autocomplete {input, sessionToken?, lat?, lng?}
    POST /text        {query, lat?, lng?}
    POST /route       {from:{lat,lng}, to:{lat,lng}, departAt?}
    POST /quiet       {from:{lat,lng}, to:{lat,lng}, whenISO?}
    GET  /auth/nonce                 → a number to answer, two minutes, one use
    POST /auth/verify {token, nonce} → Play's word on this app, for a day pass
    POST /billing/status  {install}  → subscribed, or free plans left
    POST /billing/verify  {install, token} → a Play purchase, checked with Google
    GET  /trips                      → what the drive pool says so far
    POST /trip        {car, km, climb, tempC, predictedPct, actualPct, ...}

`/route` returns the road cut into steps — `{distance, seconds, quietSeconds,
steps:[{polyline, distance, duration}]}` — because the simulation walks it a
step at a time and each step's own speed is what the physics is built on. The
polylines come back still encoded; decoding is the client's job, and sending
the points expanded would triple the response for no new information.

`/quiet` is the same road at 3am, the divisor that turns a traffic-aware
duration into a ratio. It is cached for a day across everybody, which is the
whole argument for this service: the on-device cache only ever answered its
own owner.

`/nearby` is the one that matters. It is keyed on a rounded circle centre, so
two drivers on the same road hit the same cache entry.

---

## Cost, and why the cache shape is what it is

Nearby Search with the EV field mask is Enterprise-tier. A 500 km corridor is
about seven calls. With no cache that is seven per plan, per person.

The circle centre is snapped to a grid an eighth of the radius wide — about
5.6 km on a 45 km sweep — and shared, so the second driver on that road pays
nothing for six hours. Fine rounding was tried first and does not work: two
points twenty metres apart share a cell only if no boundary falls between them,
and boundaries every 110 m make that a coin toss. On a popular route the marginal cost of a plan approaches zero; on a
road nobody drives it stays seven.

Availability is stored beside the location rather than inside it, with its own
fifteen-minute life, so a cache hit six hours old still returns fresh bay counts
if anyone has asked in the last quarter of an hour.

---

## Two switches, and why neither is a flag

**Attestation** turns on when `SERVICE_ACCOUNT` and `SESSION_SECRET` exist.
**Billing** turns on when `SERVICE_ACCOUNT` and `BILLING_PRODUCT` exist. Neither
has a boolean of its own, on purpose: a flag set to "enforce" with no
credentials is a service that refuses everybody, and set the other way it is one
that lets everybody through while the dashboard says it does not. Deriving the
state from the credentials makes both of those impossible, and `/health` reports
which state it is actually in — an attestation that quietly stopped being
enforced looks exactly like one that works.

    npx wrangler secret put SERVICE_ACCOUNT   # the JSON key file, whole
    npx wrangler secret put SESSION_SECRET    # any long random string
    npx wrangler secret put BILLING_PRODUCT   # e.g. safar_plus_monthly
    npx wrangler secret put FREE_PLANS        # optional, defaults to 15

**Attestation locks out debug builds**, which is the point — they are not from
Play and Google says so. Set it after there is a build on a test track, not
before.

**Billing gates the Google charger lookup and nothing else.** Not the app, not
planning: the physics runs on the phone and costs nothing, and charging for
arithmetic is not a business. Past the free allowance the service answers
`degraded`, which the app already turns into Open Charge Map and OpenStreetMap —
so a driver out of free plans still gets a plan with chargers in it, without the
ratings and live bay counts that cost about a rupee a call to provide.

A *plan* is counted, not a call. One 500 km corridor is six or seven lookups;
they all carry the same plan id and the first one is what counts.

The install id is the only per-device thing this service sees, it is stored as a
hash, and the app does not even create one until `/config` says billing is on.
It identifies an installation and not a person: reinstalling resets the
allowance. That is a known hole, and cheaper than the alternative, which is
accounts.

## Abuse

The Worker is public, so it is now the thing worth attacking rather than the
key.

- **Rate limit** per IP, in KV, sliding window. Generous enough that a real
  drive never notices, tight enough that a script does.
- **Daily budget.** A counter per upstream SKU. Past the ceiling the Worker
  serves cache and refuses upstream calls, which fails soft: old chargers rather
  than no app.
- **Shape checks.** Radius, coordinates and payload sizes are bounded before
  anything is forwarded.
- **No open proxy.** Only the endpoints above; nothing takes a URL.

None of it authenticates users, because there are none. It is there to make the
Worker uninteresting, not impregnable.

---

## Deploying

    wrangler kv namespace create SAFAR_CACHE
    wrangler kv namespace create SAFAR_TRIPS
    # put the ids in wrangler.toml

    wrangler secret put GOOGLE_KEY
    wrangler secret put OCM_KEY        # optional, Open Charge Map
    npm run deploy

Then point the app at it: in `web/index.html`, `PROXY` becomes the Worker's URL
and every Google call goes through it. Until that constant is set the app
behaves exactly as it does today, which is what lets this branch sit here
unfinished without breaking anything.
