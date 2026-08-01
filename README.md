# Route Section — Android

EV trip energy planner. Reads the road's cross-section, adds the air you'll
push through, and tells you the charge you'll have left on arrival.

## Build

1. Open the `EVRouteSection` folder in Android Studio (Ladybug or newer).
2. Let it sync — it will download Gradle and the Android Gradle Plugin itself.
3. Run, or `Build > Build APK(s)` for an installable file.

Command line, once a wrapper exists (`gradle wrapper` or Android Studio's sync):

    ./gradlew assembleDebug
    # app/build/outputs/apk/debug/ev-route-planner-debug.apk

Requires JDK 17, compileSdk 35, minSdk 26 (Android 8.0).

## Shape of the thing

The planner is one HTML file at `app/src/main/assets/index.html`, loaded into a
WebView. It is the same file that runs in a desktop browser, so there is a
single implementation to keep correct rather than two that drift apart.
To change the planner, edit that asset. `MainActivity.kt` only supplies the
window, persistent storage and link handling.

## Data sources

| Purpose  | Service                                  | Key needed |
|----------|------------------------------------------|------------|
| Places   | Photon (OpenStreetMap)                   | no         |
| Routing  | OSRM public server                       | no         |
| Terrain  | Terrarium tiles, AWS Open Data           | no         |
| Weather  | Open-Meteo                               | no         |
| Chargers | Open Charge Map                          | bundled    |
| Chargers | Google Places (ratings, live bay counts) | optional   |
| Chargers | OpenStreetMap via Overpass               | no         |

## Developer panel

At the bottom of the app:

- **Open Charge Map key** — overrides the bundled one. Leave blank to use it.
- **Google Maps / Places key** — adds star ratings, review counts and, where
  the network reports them, live free-bay counts. Enable **Places API (New)**
  and restrict the key to that API alone.
- **Test charger sources** — calls each source and reports status and latency.
  Use it when a lookup returns nothing, to tell an empty region from a broken
  service.
- **Clear cached terrain** — drops saved elevation legs and the tile cache.

## On the bundled key

The Open Charge Map key is base64'd in the asset so it is not visible in the
UI. That is obfuscation, not secrecy: anyone can unzip the APK and decode it.
This is acceptable for an Open Charge Map key, which is free, read-only and
carries no billing.

It is **not** acceptable for a Google Maps key, which bills to your account.
Do not hard-code one. Enter it in the developer panel, where it stays in the
app's local storage on that device, and restrict the key in Cloud Console by
API — Android app restrictions rely on the calling package signature, which a
WebView request does not carry.

## Calibration

Under "Calibration & vehicle physics", enter two real trips in your car: one
that climbs, one flat. Driving time matters more than anything else, because
the model solves both trips simultaneously for drivetrain efficiency and a
road-load scale, and each trip's average speed is what separates them.

If both reference trips average under 45 km/h the app warns you: air
resistance is barely present in slow data, so highway predictions become an
extrapolation. One steady highway reference trip fixes that.
