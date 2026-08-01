# EV Route Planner — iOS

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
