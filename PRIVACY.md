# Privacy Policy — Safar

**Last updated: 8 August 2026**

Safar ("the app") plans an electric-car journey: how much charge a
drive will cost, where you drop to your reserve, and where you could charge.

**There is no account and no login. We operate no server, so nothing you do in
the app is sent to us and we hold no data about you.** The app does show ads,
and it can ask for your location if you tap the button that needs it. Both are
described below.

## What stays on your device

Everything the app remembers is stored locally on the phone and never leaves it:

- Your trip log (distance, elevation gain, predicted and actual charge used)
- Cached terrain data, so a route you have planned before replans quickly
- Your car settings and calibration figures
- Your theme and data-source preferences

Uninstalling the app deletes all of it. None of it is backed up to us, because
there is no "us" to back it up to — we run no servers.

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
| The place text you type | Google Places, or Photon (Komoot) | Turning "Manali" into a point |
| Start and destination coordinates | Google Routes, or OpenRouteService / OSRM | Getting the road between them |
| Coordinates along the route | Open-Meteo, AWS Open Data (terrain tiles) | Ground height and weather |
| Coordinates along the route | Google Places, Open Charge Map, OpenStreetMap (Overpass) | Finding chargers |
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

The Google API key used for those requests is built into the app. It is ours,
not yours — you are never asked for a key and billing for it never reaches you.

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
