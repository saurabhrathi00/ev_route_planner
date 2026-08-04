# EVRoute — iOS

A WKWebView around the same `index.html` that runs in the browser and in the
Android app. No iOS-specific planner code exists, and none should: the physics,
the UI and the charger logic live in `web/index.html`.

## Build

Needs **Xcode** (the Command Line Tools alone are not enough).

    ./tools/build.sh             # from the repo root, after editing web/index.html
    open ios/EVRoutePlanner.xcodeproj

Pick a simulator or your device and press Run.

To run on a physical iPhone you need a signing team: Xcode → target
*EVRoutePlanner* → Signing & Capabilities → check *Automatically manage
signing* and pick your Apple ID. A free Apple ID works, but the build expires
after 7 days and must be re-installed; a paid Developer account ($99/yr) lasts
a year.

## Regenerating the project

`EVRoutePlanner.xcodeproj` is generated from `project.yml`, so edit the yml
rather than the project file:

    brew install xcodegen
    cd ios && xcodegen

## No Xcode? Use the PWA instead

`web/index.html` is a full progressive web app. Open it in Safari on the phone,
then Share → *Add to Home Screen*. You get a standalone icon, offline start-up
and the same planner, with no Xcode, no signing and no developer account. For
most people this is the better route; the native wrapper exists for the App
Store and for the file-backed storage guarantees.

## What is shared, and what is not

The planner — every screen, the physics, the charger logic, the map, the pin
picker — is `web/index.html`, and `tools/build.sh` writes it into all three
targets at once. Change it and iOS gets the change with no iOS work at all.
`app/src/main/assets/index.html` and `ios/Resources/index.html` are the same
bytes; if they ever differ, build.sh has not been run.

Only the shell around the WebView is per-platform, and it is deliberately
thin. Current state against `MainActivity.kt`:

| | Android | iOS |
|---|---|---|
| WebView, storage, link handling | yes | yes |
| Location for the Start field | yes | yes, via `GeolocationBridge` |
| AdMob banner | yes | **not yet** |

The ads SDK is the one real gap. It needs a Swift Package dependency and a
banner view under the WebView, mirroring what `MainActivity.attachBanner`
does — the banner sits below the web view rather than over it, because the
planner has its own fixed bar at the foot of the page. It is not urgent: the
app is not on the App Store yet, and AdMob does not serve live ads to an app
that is not published.

## Why geolocation needs a bridge here and not on Android

WKWebView gates `navigator.geolocation` on a secure origin, and a page loaded
from `file://` does not have one. The call neither succeeds nor says why.
`GeolocationBridge` replaces the API before the page runs and answers it from
CoreLocation instead, in the shape the W3C spec promises, so the planner
cannot tell the difference — which is the point of keeping one file.
