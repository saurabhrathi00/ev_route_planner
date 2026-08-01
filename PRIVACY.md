# Privacy Policy — EV Route Planner

**Last updated: 1 August 2026**

EV Route Planner ("the app") plans an electric-car journey: how much charge a
drive will cost, where you drop to your reserve, and where you could charge.

**There is no account, no login, no advertising and no analytics. We operate no
server and we receive no data about you whatsoever.**

## What stays on your device

Everything the app remembers is stored locally on the phone and never leaves it:

- Your trip log (distance, elevation gain, predicted and actual charge used)
- Cached terrain data, so a route you have planned before replans quickly
- Your car settings and calibration figures
- Your theme and data-source preferences
- Any API key you choose to enter in Settings

Uninstalling the app deletes all of it. None of it is backed up to us, because
there is no "us" to back it up to — we run no servers.

## What is sent to other services

To plan a drive, the app has to ask public mapping services about the road. It
sends the following, directly from your phone to those services:

| Sent | To | Why |
|---|---|---|
| The place text you type | Photon (Komoot) | Turning "Manali" into a point |
| Start and destination coordinates | OpenRouteService, or the OSRM demo server | Getting the road between them |
| Coordinates along the route | Open-Meteo, AWS Open Data (terrain tiles) | Ground height and weather |
| Coordinates along the route | Open Charge Map, OpenStreetMap (Overpass) | Finding chargers |
| Map viewport coordinates | OpenStreetMap tile servers | Drawing the map |

**The app never reads your device's location.** It has no location permission and
cannot ask for one. The only coordinates involved are the ones derived from
places you typed yourself.

Nothing is sent that identifies you: no device ID, no advertising ID, no account,
no name, no contact details.

Each of those services has its own privacy policy and its own logs, which are
outside our control:

- Photon / Komoot — <https://photon.komoot.io>
- OpenRouteService — <https://openrouteservice.org/privacy-policy/>
- OSRM demo server — <https://project-osrm.org>
- Open-Meteo — <https://open-meteo.com/en/terms>
- Open Charge Map — <https://openchargemap.org/site/about/privacy>
- OpenStreetMap / Overpass — <https://osmfoundation.org/wiki/Privacy_Policy>

## Optional: your own Google key

Settings lets you paste your own Google Maps Platform API key. If you do:

- The key is stored **only on your device** and is sent **only to Google**
- It is used for charger lookups, and for routing, place search and map tiles if
  you switch the source setting to "Everything"
- Google's handling of those requests is covered by
  <https://policies.google.com/privacy>
- Billing for that key is between you and Google; we have no visibility into it

Clear the field and the app returns to the free services immediately.

## Links out of the app

Buttons such as "Navigate in Google Maps", "Chargers on PlugShare" and "Open in
OpenStreetMap" hand a set of coordinates to another app or website. Once you tap
one, you are in that app and its privacy policy applies, not this one.

## Fonts

The app loads typefaces from Google Fonts (`fonts.googleapis.com`,
`fonts.gstatic.com`), which means your IP address is visible to Google when the
app first opens. No key or identifier is attached.

## Children

The app is a driving tool and is not directed at children. It collects nothing
from anyone, of any age.

## Changes

If this policy changes, the date at the top changes with it, and the new version
appears at the same URL.

## Contact

Questions about this policy: **sbh7435@gmail.com**
