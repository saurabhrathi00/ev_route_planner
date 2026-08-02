# Backlog — proxy backend and subscriptions

Deferred work. The app ships today with the key bundled, a hard daily quota cap
in Cloud Console, and ads. That costs nothing to run and needs no server. This
file is what to build when ads stop being enough.

---

## Why this is deferred, not abandoned

Google Places **Nearby Search** is the app's differentiator. It is the only
source with star ratings and live free-bay counts, and it has coverage where
Open Charge Map has none — 14-20 chargers in Himachal against zero. Everything
here exists to let that feature scale.

It bills at the **Enterprise + Atmosphere** SKU because the field mask asks for
`evChargeOptions`, `rating` and `userRatingCount`. India pricing: **$12 per 1000
calls, 7,000 free per month.**

> **Do not trim that field mask to save money.** Dropping `evChargeOptions` and
> `rating` would move the call to the Pro SKU ($9.60/1000, 35,000 free) — five
> times the free allowance — but it removes live bay counts, which is the whole
> reason a user would pay. Cut cost by making fewer calls, not worse ones.

The current shape of the cost, after the corridor radius goes to 40 km:

| Corridor length | Calls | Cost |
|-----------------|-------|------|
| 120 km          | 2     | ₹2.1 |
| 300 km          | 5     | ₹5.2 |
| 500 km          | 8     | ₹8.4 |
| 1000 km         | 16    | ₹16.7 |

Roughly **₹0.017 per km of distinct route explored**. Note the unit: a user who
replans the same route ten times costs nothing, because `CHG_CACHE` keys on a
two-decimal grid and hits. A user who browses ten different destinations pays
ten times. The exposure is distinct corridors, not button presses.

## When to pick this up

Any one of these:

- Ad revenue plateaus and the quota cap is being hit most days
- The daily cap is degrading the feature often enough that users notice
- Someone extracts the bundled key and burns the quota (bill stays ₹0 because
  of the cap, but the feature dies for real users)

---

## Phase 1 — proxy and shared cache

Ship this on its own. It is worth doing even with no subscription attached: it
takes the key off the device, and the shared cache cuts the bill by an order of
magnitude. Do not couple it to billing.

**Stack.** A Cloudflare Worker and a KV namespace. No VM, no container, no
deploy pipeline — `wrangler deploy` and it is live. Free tier covers 100k
requests a day. New folder `server/`, holding `wrangler.toml` and `src/index.js`.

**Endpoint.**

    POST /chargers   { lat, lng, radiusKm }
    Header: X-App-Token: <injected by tools/build.sh>

**Flow.**

1. Check the token; rate-limit per IP with a KV counter.
2. Key the cache `chg:{lat.toFixed(2)}:{lng.toFixed(2)}:{radiusKm}`.
3. On a hit, return it. Google is never called.
4. Check the daily budget counter. Over it, serve stale cache rather than
   calling Google — this is the runaway-bill guard, and it is not optional.
5. Call Nearby Search with the key held in the Worker's secrets.
6. Write to KV with `expirationTtl`.
7. Return Google's raw shape plus a `cachedAt` stamp.

The grid key deliberately matches the format `CHG_CACHE` already uses in
`web/index.html`, so the client and server caches align on the same geometry.

**The point of the shared cache.** Without it, cost scales with users — every
user fetches the Delhi–Manali corridor separately. With it, cost scales with
*distinct geography over time*, which is bounded. The corridor is fetched once
and served to everyone. A heavy user stops being a liability and starts warming
the cache for everybody else.

**TTL.** Start at six hours to hold cost down; tighten toward one hour as
revenue allows. Live bay counts going stale by an hour does not matter — the
driver arrives two hours later anyway. Surface it honestly in the UI
("chargers as of 2h ago") rather than implying it is live.

**Client change.** `chargersGoogle()` needs a new URL and headers. The response
mapping stays exactly as it is, because the Worker returns Google's shape
unchanged.

`X-App-Token` still ships inside the bundle. That is fine — unlike the Google
key it is revocable without touching Cloud Console, and it is rate-limited.
Strictly better than today.

**Also unblocked by this.** Mappls answers a CORS preflight with 403 and cannot
be called from a browser, which is why the credential slots in `secrets.env` sit
unused. A server-side proxy is exactly what those slots were waiting for.

## Phase 2 — billing

**Products.** `evroute_pro_monthly` ₹99, `evroute_pro_yearly` ₹799. The annual
price is the one to push: lower churn, cash upfront.

**RevenueCat** rather than the Play Developer API directly. It handles receipt
verification, renewals and webhooks, and is free below $2,500/month of revenue.

**The Android bridge.** Play Billing cannot run inside a WebView, so
`MainActivity.kt` gains Play Billing plus RevenueCat and exposes three methods
over `addJavascriptInterface`:

    appUserId(): String     // RevenueCat's anonymous ID
    isPro(): Boolean
    openPaywall()

About eighty lines. This is the one part that erodes the arrangement described
in the README, where `MainActivity` only supplies the window and storage. There
is no way around it — accept it and keep the bridge as thin as possible.

**Entitlement check in the Worker.** Read `X-User-Id`, look up `ent:{userId}` in
KV, and on a miss ask RevenueCat and cache the answer for an hour. Without that
cache every charger search costs an extra round trip. Not entitled → 402.

RevenueCat's anonymous ID is a random UUID, so it cannot be guessed. Good enough
for a first version.

## Phase 3 — Play Console

Start the **merchant account** first whatever else is happening; verification
takes two to seven days and everything else can proceed in parallel. Bank
details and PAN are enough — GST registration is not required for a service
supplier below ₹20 lakh of annual turnover (Notification 65/2017-Central Tax
exempts services sold through an e-commerce operator). Leave the GSTIN field
blank. Confirm with a CA before selling outside India, where export-of-services
rules differ.

The app listing stays **Free**. A subscription is an in-app product, not a paid
app.

Two things that are easy to miss and will fail review:

- **Data safety form** — location now leaves the device and reaches your server.
  Declare it: "Location — collected, sent off-device."
- **PRIVACY.md** — same disclosure, and mention the proxy.

Then the usual `RELEASE.md` flow with a bumped `versionCode`.

---

## Where each tier earns

Ads and subscription are not alternatives; they monetise different costs.

- **Ads on the free tier.** Photon, ORS, Terrarium, Open-Meteo, Open Charge Map
  and Overpass all cost nothing to call, so ad revenue against them is pure
  margin. This is what the ninety-odd percent who will never pay are worth.
- **Subscription on Google chargers.** The only feature with a real marginal
  cost, and the only one worth paying for.

The line between free and paid falls naturally where the bill does. Do not gate
the physics model or calibration — that is what makes the app worth opening, it
costs nothing to run, and gating it kills the funnel that ads and subscriptions
both depend on.

Keep the developer panel's bring-your-own-key option in either case. Those users
cost nothing and are a different audience; they do not cannibalise anything.

## Web build

`dist/` cannot run Play Billing. Leave the web build on the free sources only
and keep monetisation on Android. The web build earns its keep as a demo.

---

---

## Checking chargers against the operator's own server

From tester feedback: *"Double check charger with service provider's server too
as plugshare is not that reliable everywhere."*

Two things worth separating.

**The app does not use PlugShare.** It only links out to it, because PlugShare
has the best community data there is and no API anyone outside it can reach.
Charger data comes from Google Places, Open Charge Map and OpenStreetMap, and
they are already merged and cross-checked against each other. Where a network
reports live free-bay counts, Google carries them and the app shows them.

**The real gap is Indian operators none of those three cover** — Tata Power EZ
Charge, Statiq, ChargeZone, Jio-bp Pulse, Ather Grid, Zeon, Kazam. Their own
apps know which bays are free right now; the aggregators often do not.

This cannot be done from the app as it stands:

- None of them publish a documented public API. Endpoints exist behind their
  own apps, but they are undocumented, unversioned and free to change.
- The ones that answer at all send no CORS headers, so a browser cannot read
  the response. Open Charge Map works precisely because it echoes the origin
  back; these do not.
- The Android and iOS builds load from `file://`, whose origin is `null`. A
  server that sends `Access-Control-Allow-Origin: *` is fine with that, but
  one that whitelists specific origins can never be satisfied — the same wall
  Mappls is behind in `secrets.env`.

So this is Phase 1 work, not app work. Once the Worker exists, an operator
lookup is a second endpoint beside `/chargers`: server-side fetch, no CORS,
credentials held off the device, and the same shared cache in front of it so
one lookup serves every user in that area.

Two cautions for when it happens. Scraping an undocumented endpoint is a
standing maintenance cost and can breach the operator's terms — worth asking
for a partner or developer agreement first, which several of them have.
And treat the operator as one more source to merge, not as the truth: it is
authoritative about its own chargers and knows nothing about anyone else's.

---

## Order

| Step | Effort | Result |
|------|--------|--------|
| Corridor radius 25 → 40 km | 30 min | cost halved, no other change |
| Phase 1 | 2-3 days | key off-device, bill cut by 10-50× |
| Phase 2 | 4-5 days | subscriptions live |
| Phase 3 | parallel | Play paperwork |
