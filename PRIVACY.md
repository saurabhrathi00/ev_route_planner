# Privacy Policy — Safar

**Last updated: 8 August 2026**

Safar ("the app") plans an electric-car journey: how much charge a
drive will cost, where you drop to your reserve, and where you could charge.

**There is no account and no login. We hold no data about you.** The app does
show ads, and it can ask for your location if you tap the button that needs it.
Both are described below.

We do now run one service, and it changed one sentence this policy used to
carry. Map, charger and routing requests used to go from your phone straight to
Google; they now go through a relay we operate, which asks Google on your
behalf. It is described in full under **The service we run**. It exists to keep
our API key off your phone, and it stores roads and chargers — not people.

## What stays on your device

Everything the app remembers is stored locally on the phone and never leaves it:

- Your trip log (distance, elevation gain, predicted and actual charge used)
- Cached terrain data, so a route you have planned before replans quickly
- Your car settings and calibration figures
- Your theme and data-source preferences

Uninstalling the app deletes all of it. None of it is backed up to us, and none
of it is ever sent to us — the trip log included, unless you switch on the
sharing described below, which is off until you do.

## Your location

The Start field has a "use my current location" button. **Nothing happens until
you tap it.** The app does not track you, does not read your location in the
background, and does not read it at all unless you ask.

When you do tap it:

- Android asks your permission first; you can refuse, and the app carries on
  working from typed place names
- The coordinates are used to fill in the Start field and to plan the route
- They are sent to the same mapping services listed below — the same way a
  place you typed would be — so that the point can be given a name and a road
  can be found from it
- They are not stored anywhere except in the app's own local storage on your
  phone, and they are not sent to us

You can withdraw the permission at any time in Android's app settings.

## What is sent to other services

To plan a drive, the app has to ask mapping services about the road. It sends
the following, directly from your phone to those services:

| Sent | To | Why |
|---|---|---|
| The place text you type | Google Places (through our relay), or Photon (Komoot) | Turning "Manali" into a point |
| Start and destination coordinates | Google Routes (through our relay), or OpenRouteService / OSRM | Getting the road between them |
| Coordinates along the route | Open-Meteo, AWS Open Data (terrain tiles) | Ground height and weather |
| Coordinates along the route | Google Places (through our relay), Open Charge Map, OpenStreetMap (Overpass) | Finding chargers |
| Map viewport coordinates | Google Maps, or OpenStreetMap tile servers | Drawing the map |

Nothing is sent to these services that identifies you: no account, no name, no
contact details. Your IP address is necessarily visible to them, as it is to any
website you open.

Which service answers depends on the **Where data comes from** setting. The
default sends map, search, routing and charger requests to Google, with the free
services used as fallbacks when Google fails. Setting it to **Free** stops the
app contacting Google for any of them.

Each service has its own privacy policy and its own logs, outside our control:

- Google Maps Platform — <https://policies.google.com/privacy>
- Photon / Komoot — <https://photon.komoot.io>
- OpenRouteService — <https://openrouteservice.org/privacy-policy/>
- OSRM demo server — <https://project-osrm.org>
- Open-Meteo — <https://open-meteo.com/en/terms>
- Open Charge Map — <https://openchargemap.org/site/about/privacy>
- OpenStreetMap / Overpass — <https://osmfoundation.org/wiki/Privacy_Policy>

The Google API key used for those requests is ours, not yours — you are never
asked for a key and billing for it never reaches you. The key for the map itself
is built into the app, because the map library runs on your phone and talks to
Google directly; it can do nothing but draw maps. The rest of the key lives on
our relay, described next.

## The service we run

Charger, place-search and routing requests go through a small service we
operate, at `safar-api.safar-app.workers.dev`. It runs on Cloudflare Workers.
Two reasons, and only two:

**It holds the key.** An app that calls Google directly has to carry the key
inside it, where anyone can read it out and spend it. Ours now sits on the
service instead.

**It shares the answers.** Chargers on a road are the same chargers whoever is
driving it. One person's lookup answers the next person's, which is why the app
can afford to ask Google for live free-bay counts at all.

What reaches it, and what becomes of it:

| Reaches the service | Kept | For how long |
|---|---|---|
| Coordinates of a stretch of road you are planning through | The chargers found there, under a location rounded to a few km — not under you | 6 hours (bay counts, 15 minutes) |
| Start and destination coordinates | The road between them, under those two points | 7 days |
| Place text you type in the search box | Nothing | — |
| Your IP address, as with any web request | A request counter, under a one-way hash of the address that changes every minute | 2 minutes |

There is no account, no identifier, no cookie and no log of who asked for what.
The cache is keyed on places, not people: a stored entry says "there are four
chargers near here", and there is nothing in it, or beside it, to say who asked.
Requests are not linked to each other, so the service cannot assemble a journey
even in principle — it never learns that the person asking about one stretch of
road is the person who asked about the next.

Your IP address is visible to Cloudflare while a request is being handled, as it
is to any website you open — <https://www.cloudflare.com/privacypolicy/>.

## Sharing your drives (off by default)

The Log screen has a switch marked **Help fix the model**. It is off. Turned on,
each drive you log is sent to the service above, and it carries: the car, the
distance, the height climbed, the temperature, the average speed, how many
people were aboard, the air-conditioning setting, and the two percentages — what
the app predicted and what the drive actually cost.

It does not carry where you started, where you went, when you drove, or anything
that identifies you or your phone. Start and destination are the two facts about
a journey that point at a person, and the physics has no use for either.

Why ask at all: the model is anchored on two drives taken from a published range
test, and real drives across many cars, roads and seasons are the only thing
that can replace them. Switching it off stops anything further being sent.
Records already sent cannot be traced back and removed, because nothing in them
identifies who sent it — which is the same property that makes them safe to
send.

## Advertising

The app shows a banner ad from **Google AdMob**. To serve it, AdMob collects
information from your device independently of anything the app does:

- Your device's **advertising ID**
- Your IP address, and device and network information
- Whether ads were shown, viewed or tapped

This is handled by Google, not by us. We never see it, and we cannot connect it
to your routes, your trips or anything else in the app — the ad and the planner
do not share data.

The Android build also carries the Privacy Sandbox permissions the ads SDK
requires — `AD_ID`, and the Topics, Attribution and Ad ID access the Android
advertising system uses. They arrive with the SDK; the app itself reads none of
them.

**Your choice about this.** Before any advertisement is requested, the app asks
through Google's consent platform. Where the law gives you a say — the EEA, the
UK, and the American states that grant a right to opt out of sharing for
targeted advertising — you are asked before the first ad, and you can change
your answer at any time: **Settings → About Safar → Advertising choices**. If
you say no, or if we cannot reach the consent service at all, no advertisement
is requested.

- How Google uses this data: <https://policies.google.com/technologies/partner-sites>
- You can reset or delete your advertising ID, and turn off ad personalisation,
  in **Android Settings → Privacy → Ads**

**The iOS build carries no advertising**, no ad SDK, and no advertising
identifier.

## Analytics

There are none. The app collects no usage statistics and reports no crashes to
us. We do not know how many people use it or what they do in it.

## Links out of the app

Buttons such as "Navigate in Google Maps", "Chargers on PlugShare" and "Open in
OpenStreetMap" hand a set of coordinates to another app or website. Once you tap
one, you are in that app and its privacy policy applies, not this one.

## Fonts

The app loads typefaces from Google Fonts (`fonts.googleapis.com`,
`fonts.gstatic.com`), which means your IP address is visible to Google when the
app first opens. No key or identifier is attached.

## Children

The app is a driving tool and is not directed at children.

## Changes

If this policy changes, the date at the top changes with it, and the new version
appears at the same URL.

## Contact

Questions about this policy: **support@voxhelperai.com**
