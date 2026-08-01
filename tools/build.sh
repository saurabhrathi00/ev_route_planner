#!/usr/bin/env bash
# Builds the planner for all three targets from the single source, web/index.html.
#
#   ./tools/build.sh
#
# The API key is injected here rather than typed in by the user. Be clear-eyed
# about what that does and does not buy: this app has no server, so the key is
# shipped to every browser and sits inside every APK. Anyone can read it out.
# Injecting at build time keeps the key out of git and out of the UI; it does
# NOT make it secret. The protections that actually matter are on Google's side
# — restrict the key to the APIs below, and set a hard daily quota cap on each.
# If the key must genuinely stay private, it has to move behind a proxy.
#
#   APIs this build expects: Routes API, Places API (New),
#                            Maps JavaScript API, and Places for chargers.
#
# Outputs:
#   dist/                          the web build — serve this, not web/
#   app/src/main/assets/index.html the Android bundle
#   ios/Resources/index.html       the iOS bundle
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=web/index.html
[ -f "$SRC" ] || { echo "missing $SRC" >&2; exit 1; }

# key from the environment, else from secrets.env (gitignored), else empty
if [ -z "${GOOGLE_MAPS_KEY:-}" ] && [ -f secrets.env ]; then
  set -a; . ./secrets.env; set +a
fi
KEY="${GOOGLE_MAPS_KEY:-}"
ORS="${ORS_KEY:-}"

if [ -z "$KEY" ]; then
  echo "!  no GOOGLE_MAPS_KEY found — building the free-sources version."
  echo "   put GOOGLE_MAPS_KEY=... in secrets.env to bundle Google."
else
  echo "✓  bundling Google key ...${KEY: -6}"
fi

rm -rf dist && mkdir -p dist app/src/main/assets ios/Resources

[ -n "$ORS" ] && echo "✓  bundling OpenRouteService key" || echo "!  no ORS_KEY — routing falls back to the OSRM demo server"

KEY="$KEY" ORS="$ORS" python3 - "$SRC" <<'PY'
import os, re, sys, shutil, pathlib

src = sys.argv[1]
key = os.environ.get('KEY', '')
ors = os.environ.get('ORS', '')
html = open(src, encoding='utf-8').read()

for token in ('__GOOGLE_MAPS_KEY__', '__ORS_KEY__'):
    if token not in html:
        raise SystemExit('build: %s placeholder missing from the source — refusing to guess' % token)
built = html.replace('__GOOGLE_MAPS_KEY__', key).replace('__ORS_KEY__', ors)

# the web build keeps the PWA plumbing
pathlib.Path('dist/index.html').write_text(built, encoding='utf-8')
for extra in ('manifest.webmanifest', 'sw.js'):
    shutil.copy(f'web/{extra}', f'dist/{extra}')
shutil.copytree('web/icons', 'dist/icons', dirs_exist_ok=True)

# the app bundles do not: no service worker, no web app manifest to read
drop = [
    '<link rel="manifest" href="manifest.webmanifest">\n',
    '<meta name="mobile-web-app-capable" content="yes">\n',
    '<meta name="apple-mobile-web-app-capable" content="yes">\n',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">\n',
    '<link rel="apple-touch-icon" href="icons/icon-192.png">\n',
]
native = built
for d in drop:
    if d not in native:
        raise SystemExit('build: expected tag not found, refusing to guess:\n  ' + d.strip())
    native = native.replace(d, '')
native, n = re.subn(r"<script>\s*\nif\('serviceWorker' in navigator.*?</script>\n", '', native, flags=re.S)
if n != 1:
    raise SystemExit('build: service-worker block not found exactly once (found %d)' % n)

for path in ('app/src/main/assets/index.html', 'ios/Resources/index.html'):
    pathlib.Path(path).write_text(native, encoding='utf-8')

print('   dist/index.html, android and ios bundles written (%d bytes each)' % len(native))
PY

SHA=$(shasum -a 256 app/src/main/assets/index.html | cut -d' ' -f1)
BYTES=$(wc -c < app/src/main/assets/index.html | tr -d ' ')
STAMP=$(grep -oE 'build [0-9]{4}-[0-9]{2}-[0-9]{2} r[0-9]+' "$SRC" | head -1 | sed 's/^build //')
printf 'EVRoute — build %s\n\nplanner sha256   %s\nplanner bytes    %s\n' \
  "${STAMP:-unstamped}" "$SHA" "$BYTES" > BUILD.txt

# a bundled key must never reach git through the source file
if grep -q "__GOOGLE_MAPS_KEY__" "$SRC" && grep -q "__ORS_KEY__" "$SRC"; then
  echo "✓  source still holds the placeholder (nothing secret committed)"
else
  echo "!! web/index.html no longer has the placeholder — a key may have leaked into the source" >&2
  exit 1
fi
echo "done."
