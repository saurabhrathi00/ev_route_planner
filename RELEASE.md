# Shipping to Google Play

Everything the repo can do for you is done: the release build is wired for
signing, produces an `.aab`, and there is a privacy policy to host. The rest is
Play Console work that only you can do.

---

## 1. Make the upload key — once, and never lose it

    keytool -genkeypair -v \
      -keystore upload-keystore.jks \
      -alias upload \
      -keyalg RSA -keysize 2048 -validity 10000 \
      -storetype JKS

It asks for a password and a few identity fields. Then:

    cp keystore.properties.example keystore.properties
    # fill in storePassword, keyPassword (usually the same), keyAlias=upload

> **Back up `upload-keystore.jks` and the passwords somewhere you will still
> have them in five years.** Lose them and you cannot ship an update to this app
> ever again — Play will only accept uploads signed with the same key. Not a
> single folder on one laptop. (Play App Signing gives a recovery path if you
> enrol, but do not rely on it.)

`keystore.properties` and `*.jks` are gitignored.

## 2. Build the bundle

    ./tools/build.sh                 # regenerates the planner into the app
    ./gradlew bundleRelease          # -> app/build/outputs/bundle/release/app-release.aab

There is no wrapper checked in, so `./gradlew` only exists once Android Studio
has synced the project once. Failing that, any Gradle 8.9 or newer will do —
the Android plugin is 8.7.3 and refuses anything older.

Play wants the `.aab`, not an APK. Check it is signed:

    jarsigner -verify -verbose app/build/outputs/bundle/release/app-release.aab | head -3

Every upload needs a **higher `versionCode`** than the last — bump it in
`app/build.gradle.kts` before each release.

## 3. Host the privacy policy

Play will not publish without a working privacy-policy URL. `PRIVACY.md` is
written and accurate for this app. Publish it anywhere public — GitHub Pages is
free and takes minutes — and paste the URL into the console.

## 4. Play Console

One-off **$25** developer registration, and identity verification that can take
a few days. Start that early; it is the slowest step.

Then create the app and fill in:

**Store listing**
- Short description (80 chars) and full description (4000)
- App icon **512×512 PNG** — `web/icons/icon-512.png` is exactly this size and
  ready to upload
- Feature graphic **1024×500 PNG** — `store/feature-graphic-1024x500.png`
- At least **2 phone screenshots** (16:9 or 9:16, min 320px) — `store/` has
  phone, 7-inch and 10-inch sets ready. The Plan screen, the journey view and
  the map are the three worth leading with
- Category: Maps & Navigation. Contact email. Privacy policy URL

**App content** — each of these is a separate form
- Privacy policy URL
- Ads: **Yes, contains ads** — there is an AdMob banner below the planner
- Advertising ID: **Yes**, purpose *Advertising or marketing*. The ads SDK puts
  `AD_ID` in the merged manifest, and Play cross-checks the two
- Content rating questionnaire → redo it; adding ads can change the outcome
- Target audience: **18+**. Do not tick any child age band — an app with ads
  that admits to a child audience falls under Families policy, which is a far
  stricter regime than this app is built for
- Data safety: see below
- Government apps: No
- Financial features: No

## 5. Data safety — what is true for this app

Answer from what the code actually does, and re-read this whenever the app
gains an SDK or a permission. Two things changed in v1.1 that invalidated the
previous answers entirely: the app now asks for **location**, and it now ships
**AdMob**.

What the app does today:

- Permissions: `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_FINE_LOCATION`,
  `ACCESS_COARSE_LOCATION`, plus `AD_ID` and the `ACCESS_ADSERVICES_*` set that
  the ads SDK merges in by itself.
- Location is read **only** when the user taps the crosshair in the Start field.
  Never in the background, never on launch.
- It runs no backend. Nothing is sent to the developer, and there is no
  analytics or crash reporting SDK.
- Coordinates — typed or located — go to third-party mapping services (Google
  Maps Platform, routing, terrain, weather, chargers, tiles) purely to produce
  the answer on screen.
- AdMob collects the advertising ID, IP and device information on its own. The
  app never sees it and cannot join it to anything else.

Google counts data as "collected" the moment it leaves the device, so declare
**two** data types:

**Location → Approximate location**

| Question | Answer |
|---|---|
| Collected? | **Yes** |
| Shared? | **Yes** — sent to third-party mapping services |
| Purpose | **App functionality** |
| Processed ephemerally? | Yes — not stored by us; we have no server |
| Linked to identity? | **No** |
| Used for tracking? | **No** |
| Collection optional? | **Yes** — only if the user taps the location button |
| Encrypted in transit? | **Yes** — every endpoint is HTTPS |

**Device or other IDs → Device or other IDs**

| Question | Answer |
|---|---|
| Collected? | **Yes** — the advertising ID, by AdMob |
| Shared? | **Yes** — with Google for ad serving |
| Purpose | **Advertising or marketing** |
| Linked to identity? | **No** |
| Used for tracking? | **Yes** — this is what an advertising ID is for |
| Collection optional? | **No** — it comes with the ads |
| Encrypted in transit? | **Yes** |

Users can reset or delete the advertising ID, and turn off ad personalisation,
in Android Settings → Privacy → Ads. Nothing else is retained to delete;
uninstalling clears the on-device store.

> I am not a lawyer and this is not legal advice. The declarations must match
> what the app does, and you are the one signing them. Read Google's Data safety
> guidance and check each answer against the table in `PRIVACY.md`, which lists
> every host the app talks to.

## 6. Ads

The banner ids live in `app/src/main/res/values/strings.xml`. They are not
secrets — every APK carries them in the clear — but they are easy to get wrong
in ways that cost money or an account:

- **Never tap an ad on your own build.** AdMob treats it as click fraud and
  suspends the account rather than warning it. To try the banner out, swap in
  the public test ids kept in the comment beside the real ones.
- **A newly created ad unit serves blank for hours**, sometimes a day on a new
  account. That is not a bug in the app; do not go looking for one.
- **AdMob payments and tax details take days to verify.** They do not block ads
  from serving, so start them early and forget about them.
- **EEA, UK and Switzerland need a consent flow** (Google's User Messaging
  Platform) before ads may be served there. This app does not have one, so keep
  Play availability to India until it does.

## 7. Testing tracks

A personal Play account created after 13 November 2023 must run a **closed test
with at least 12 testers, opted in continuously for 14 days**, before it can
apply for production access. Organisation accounts and older personal accounts
are exempt.

Uploading a new build does **not** reset that clock — it counts testers staying
opted in, not versions staying still. Removing testers or switching tracks does
reset it. Enrol fifteen or so, not exactly twelve, so one person losing interest
does not cost two weeks.

Use **internal testing** first regardless: it goes live in minutes and lets you
check the signed build on real devices before anyone else sees it.

## 8. Things that get apps like this rejected

- **No privacy policy URL, or one that 404s.** The single most common rejection.
- **Data safety form contradicting the app.** Declaring "no data collected"
  while the app posts coordinates to six services is a mismatch Google checks
  for, and it gets the release pulled. Since v1.1 the trap is sharper: the
  merged manifest contains `AD_ID` and a location permission, and Play reads
  both. Section 5 must be re-answered, not carried over.
- **Screenshots that do not match the app.** Use real ones from the device.
- **The bundled Google Maps key left unrestricted.** Not a Play problem but a
  you problem: the key is readable inside the AAB, and since v1.1 every build
  ships one. Restrict it by API, disable every other API on the project, and
  cap the daily quota per SKU. `README.md` has the specifics.

## 9. Before you push the button

- [ ] `./tools/build.sh` run, so the app ships the current planner
- [ ] `versionCode` bumped
- [ ] `.aab` verifies as signed
- [ ] Real AdMob ids in `strings.xml`, not the test ones —
      `aapt2 dump strings … | grep ca-app-pub` and check for `3940256099942544`
- [ ] Installed the release build on a real phone and planned one drive
- [ ] Banner renders and does not cover the Plan button — **look, do not tap**
- [ ] Location button asks for permission, and works after it is granted
- [ ] Privacy policy URL live and loading, and describing ads and location
- [ ] Data safety, Ads and Advertising ID declarations updated
- [ ] Keystore backed up in two places
- [ ] Google key restricted and quota-capped

Play's review for a first submission usually takes a few days, sometimes longer;
updates to an existing closed track are often through in hours.
