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
- Feature graphic **1024×500 PNG** — *you still need to make this one*
- At least **2 phone screenshots** (16:9 or 9:16, min 320px). The Plan screen,
  the journey view and the map are the three worth showing
- Category: Maps & Navigation. Contact email. Privacy policy URL

**App content** — each of these is a separate form
- Privacy policy URL
- Ads: **No**
- Content rating questionnaire → this app will come out "Everyone"
- Target audience: adults; not designed for children
- Data safety: see below
- Government apps: No
- Financial features: No

## 5. Data safety — what is true for this app

Answer from what the code actually does. To be accurate:

- The app requests only `INTERNET` and `ACCESS_NETWORK_STATE`. **It has no
  location permission and never reads device location.**
- It runs no backend. Nothing is sent to the developer.
- No account, no advertising ID, no analytics SDK, no crash reporting.
- Coordinates *derived from place names the user typed* are sent to third-party
  mapping services (routing, terrain, weather, chargers, map tiles) purely to
  produce the answer on screen.

Google counts data as "collected" when it leaves the device, so the honest
answer is likely:

| Question | Answer |
|---|---|
| Does your app collect or share user data? | **Yes** |
| Data type | **Location → Approximate location** |
| Collected or shared? | **Shared** (sent to third-party services) |
| Purpose | **App functionality** |
| Is it processed ephemerally? | Yes — not stored by us; we have no server |
| Is it linked to identity? | **No** |
| Used for tracking? | **No** |
| Is collection optional? | No — it is how the app works |
| Data encrypted in transit? | **Yes** — every endpoint is HTTPS |
| Can users request deletion? | Nothing is retained to delete; uninstalling clears the on-device store |

> I am not a lawyer and this is not legal advice. The declarations must match
> what the app does, and you are the one signing them. Read Google's Data safety
> guidance and check each answer against the table in `PRIVACY.md`, which lists
> every host the app talks to.

## 6. Things that get apps like this rejected

- **No privacy policy URL, or one that 404s.** The single most common rejection.
- **Data safety form contradicting the app.** Declaring "no data collected"
  while the app posts coordinates to six services is a mismatch Google checks
  for, and it gets the release pulled.
- **Screenshots that do not match the app.** Use real ones from the device.
- **A bundled Google Maps key with no restrictions.** Not a Play problem but a
  you problem: the key is readable inside the AAB. Restrict it to the exact APIs
  and set a daily quota cap before shipping.

## 7. Before you push the button

- [ ] `./tools/build.sh` run, so the app ships the current planner
- [ ] `versionCode` bumped
- [ ] `.aab` verifies as signed
- [ ] Installed the release build on a real phone and planned one drive
- [ ] Privacy policy URL live and loading
- [ ] Keystore backed up in two places
- [ ] Google key (if bundled) restricted and quota-capped

Play's review for a first submission usually takes a few days, sometimes longer.
Use **internal testing** first — it goes live in minutes and lets you check the
signed build on real devices before anyone else sees it.
