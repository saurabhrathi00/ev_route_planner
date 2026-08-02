# Signing key — do not lose this

`upload-keystore.jks` is the key every EVRoute release must be signed with.
Google Play will reject an upload signed with anything else, forever. There is
no recovery, no support ticket, no appeal: lose this file and the only way to
ship again is a new listing under a new package name, with none of the
installs, ratings or reviews.

It is 2.2 KB. **Back it up somewhere that is not this laptop** — a drive, a
password manager, anywhere that will still exist in five years. Back up the
password with it; the file alone is useless.

## What is in here

    upload-keystore.jks    the key itself       (gitignored, never committed)
    ../keystore.properties path and passwords   (gitignored, never committed)

Both are excluded by `.gitignore` (`*.jks`, `keystore.properties`). This README
is committed so the instructions survive; the secrets are not.

## Details

    alias      upload
    algorithm  RSA 2048, SHA384withRSA
    valid to   December 2053

## Building a release

    ./tools/build.sh                                   # refresh the planner
    ./gradlew bundleRelease                            # signed .aab
    # -> app/build/outputs/bundle/release/app-release.aab

Check it before uploading:

    jarsigner -verify app/build/outputs/bundle/release/app-release.aab
    # "jar verified." is what you want.
    # A warning about the certificate chain being invalid is expected and
    # fine — the certificate is self-signed, as every app signing key is.

Bump `versionCode` in `app/build.gradle.kts` before every upload. Play refuses
a versionCode it has already seen.

## About the password

This key currently uses a weak password. Changing it costs nothing **until the
first upload** — after that the key is locked to the listing and cannot be
swapped. If you want to change it, do it now:

    rm signing/upload-keystore.jks keystore.properties
    keytool -genkeypair -v -keystore signing/upload-keystore.jks \
      -alias upload -keyalg RSA -keysize 2048 -validity 10000 -storetype JKS

Keep **Play App Signing** enabled when you upload. Google then holds the real
app signing key and this is only the upload key — which, unlike the signing
key, can be rotated if it is ever compromised.
