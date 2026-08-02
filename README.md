# EVRoute — Android

EV trip energy planner. Reads the road's cross-section, adds the air you'll
push through, and tells you the charge you'll have left on arrival.

## Build

1. Open the `EVRouteSection` folder in Android Studio (Ladybug or newer).
2. Let it sync — it will download Gradle and the Android Gradle Plugin itself.
3. Run, or `Build > Build APK(s)` for an installable file.

Command line, once a wrapper exists (`gradle wrapper` or Android Studio's sync):

    ./gradlew assembleDebug
    # app/build/outputs/apk/debug/evroute-debug.apk

Requires JDK 17, compileSdk 35, minSdk 26 (Android 8.0).

## Shape of the thing

The planner is one HTML file at `app/src/main/assets/index.html`, loaded into a
WebView. It is the same file that runs in a desktop browser, so there is a
single implementation to keep correct rather than two that drift apart.
To change the planner, edit that asset. `MainActivity.kt` only supplies the
window, persistent storage and link handling.

## Data sources

Google answers first for the things it is better at; the free service behind it
takes over whenever Google fails, is switched off, or has run out of quota.
Settings → **Where data comes from** picks between *Everything* (the default),
*Chargers* and *Free*.

| Purpose  | Primary                    | Fallback                          |
|----------|----------------------------|-----------------------------------|
| Places   | Google Places (New)        | Photon, then Nominatim            |
| Routing  | Google Routes (traffic)    | OpenRouteService, then OSRM       |
| Map      | Google Maps JavaScript     | OpenStreetMap tiles, route shape  |
| Chargers | Google Places (New)        | Open Charge Map, then Overpass    |
| Terrain  | Open-Meteo, OpenTopoData, Terrarium tiles (AWS) | —            |
| Weather  | Open-Meteo                 | fixed 28 °C, no wind              |

Terrain and weather never go to Google. Open-Meteo covers both, free and without
a key, and Google has nothing better to offer for the four figures the model
needs — temperature, wind speed, wind direction, precipitation.

Reverse geocoding never goes to Google either: its Geocoding API refuses browser
requests, so place names for coordinates always come from Photon or Nominatim.

## Developer panel

At the bottom of Settings:

- **Test data sources** — calls each service this build would actually use and
  reports status and latency. Use it when a lookup returns nothing, to tell an
  empty region from a broken service. It only probes what the current source
  setting reaches, so it never bills an API the app is not using.
- **Clear cached terrain** — drops saved elevation legs and the tile cache.

There is no key field. Both keys are injected at build time by
`tools/build.sh`; see below.

## On the bundled keys

The Open Charge Map key is base64'd in the asset so it is not visible in the
UI. That is obfuscation, not secrecy: anyone can unzip the APK and decode it.
This is acceptable for an Open Charge Map key, which is free, read-only and
carries no billing.

The Google key is bundled too, and it **does** bill. Nothing in the app can
protect it — anything shipped to a device can be read off that device — so the
protection has to live in Cloud Console, and it is not optional:

- **Restrict the key by API** to exactly the three it needs: Places API (New),
  Routes API, Maps JavaScript API. Application restrictions are no use here:
  the Android option relies on the calling package signature, which a WebView
  request does not carry, and the HTTP-referrer option cannot match a page
  loaded from `file://`.
- **Disable every other API on the project.** An enabled API is reachable.
- **Set a daily quota cap on each SKU.** `SearchNearbyRequest per day` is the
  one that matters: it is billed at the Places Enterprise + Atmosphere rate,
  and it has the smallest free allowance by a wide margin.

Note that Routes API offers no daily cap, only per-minute — so that one SKU
cannot be bounded by quota alone. `backlog.md` covers the proxy that fixes this
properly.

## Calibration

Under "Calibration & vehicle physics", enter two real trips in your car: one
that climbs, one flat. Driving time matters more than anything else, because
the model solves both trips simultaneously for drivetrain efficiency and a
road-load scale, and each trip's average speed is what separates them.

If both reference trips average under 45 km/h the app warns you: air
resistance is barely present in slow data, so highway predictions become an
extrapolation. One steady highway reference trip fixes that.
