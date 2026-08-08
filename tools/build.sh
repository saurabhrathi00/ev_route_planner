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
import os, re, sys, shutil, pathlib, datetime

src = sys.argv[1]
key = os.environ.get('KEY', '')
ors = os.environ.get('ORS', '')
html = open(src, encoding='utf-8').read()

# The version the store listing carries, so the page and the listing cannot
# disagree. It was typed into the page by hand and went stale immediately.
gradle = open('app/build.gradle.kts', encoding='utf-8').read()
def one(pat, what):
    m = re.search(pat, gradle)
    if not m:
        raise SystemExit('build: could not read %s from app/build.gradle.kts' % what)
    return m.group(1)
ver  = one(r'versionName\s*=\s*"([^"]+)"', 'versionName')
code = one(r'versionCode\s*=\s*(\d+)', 'versionCode')
date = datetime.date.today().isoformat()

# The legal documents live in the repository as markdown and are rendered into
# the page here. Two reasons: what the phone shows and what the file says cannot
# drift apart, and the text is then readable with no signal — which is where a
# question about what the app promised is most likely to occur to someone.
exec(open('tools/_mdhtml.py').read())
exec(open('tools/brand.py').read())

STAMPS = {'__GOOGLE_MAPS_KEY__': key, '__ORS_KEY__': ors,
          '__TERMS_HTML__': md_to_html('TERMS.md'),
          '__PRIVACY_HTML__': md_to_html('PRIVACY.md'),
          '__BUILD_VER__': ver, '__BUILD_CODE__': code, '__BUILD_DATE__': date,
          '__PUBLISHER__': PUBLISHER, '__CONTACT__': CONTACT, '__COPYRIGHT__': COPYRIGHT,
          '__BUILD_ID__': 'v%s (%s)' % (ver, code)}
# Refusing to guess is the point of this: a missing key placeholder means
# something rewrote the source, and a build that quietly ships an empty key is
# worse than one that stops. But not every stamp has to appear — the publisher
# is available to the page whether or not the page mentions it.
REQUIRED = ('__GOOGLE_MAPS_KEY__', '__ORS_KEY__', '__BUILD_ID__',
            '__TERMS_HTML__', '__PRIVACY_HTML__', '__CONTACT__')
for token in REQUIRED:
    if token not in html:
        raise SystemExit('build: %s placeholder missing from the source — refusing to guess' % token)
built = html
for token, value in STAMPS.items():
    built = built.replace(token, value)

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

# ---- the pages the stores link to -------------------------------------------
# Both stores require a privacy policy at a URL, not a file in a repository.
# These are generated from the same markdown the app embeds, so the page a
# reviewer opens and the text on the phone are the same words. Serve docs/ with
# GitHub Pages and the URLs exist for free.
PAGES=1 python3 - <<'PY2'
import os, re, pathlib, datetime
exec(open('tools/_mdhtml.py').read())            # md_to_html, shared with the build
exec(open('tools/brand.py').read())             # and who publishes it
CSS = '''
:root{--paper:#F1F4F2;--sheet:#fff;--ink:#15201C;--ink2:#5C6B65;--ink3:#66726C;
  --rule:#DDE4E0;--green:#1D8724;--charge:#26699F}
@media (prefers-color-scheme:dark){:root{--paper:#0F1413;--sheet:#171D1B;--ink:#E7EDE8;
  --ink2:#9DA9A3;--ink3:#798680;--rule:#2C3532;--green:#5FBF5A;--charge:#6DB4E4}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink2);
  font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:68ch;margin:0 auto;padding:48px 22px 96px}
.brand{display:block;font:800 20px/1 system-ui,sans-serif;letter-spacing:-.03em;
  color:var(--ink);text-decoration:none;margin-bottom:34px}
.brand span{color:var(--green)}
h1{font:700 30px/1.2 system-ui,sans-serif;color:var(--ink);margin:0 0 6px;letter-spacing:-.02em}
h2{font:600 17px/1.3 system-ui,sans-serif;color:var(--ink);margin:32px 0 8px}
p{margin:0 0 12px} strong{color:var(--ink)} em{color:var(--ink3)}
ul{padding-left:20px;margin:0 0 12px} li{margin:4px 0}
a{color:var(--charge)}
hr{border:0;border-top:1px solid var(--rule);margin:28px 0}
table{border-collapse:collapse;width:100%;font-size:14px;margin:8px 0 14px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--rule);vertical-align:top}
th{color:var(--ink);font-weight:600}
.docwrap{overflow-x:auto}
nav{margin-top:44px;padding-top:20px;border-top:1px solid var(--rule);font-size:14px}
nav a{margin-right:16px}
footer{margin-top:28px;font-size:13px;color:var(--ink3)}
'''
def page(title, body, here):
    other = 'terms.html' if here == 'privacy.html' else 'privacy.html'
    label = 'Terms of use' if here == 'privacy.html' else 'Privacy policy'
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><style>{CSS}</style></head><body><div class="wrap">
<a class="brand" href="index.html"><span>S</span>afar</a>
{body}
<nav><a href="index.html">Safar</a><a href="{other}">{label}</a>
<a href="https://github.com/saurabhrathi00/ev_route_planner">Source</a></nav>
<footer>{COPYRIGHT} · <a href="mailto:{CONTACT}">{CONTACT}</a></footer>
</div></body></html>'''

docs = pathlib.Path('docs'); docs.mkdir(exist_ok=True)
(docs/'privacy.html').write_text(page('Privacy Policy — Safar', md_to_html('PRIVACY.md'), 'privacy.html'), encoding='utf-8')
(docs/'terms.html').write_text(page('Terms of Use — Safar', md_to_html('TERMS.md'), 'terms.html'), encoding='utf-8')
(docs/'index.html').write_text(page('Safar — EV charging and route planner', '''
<h1>Safar</h1>
<p><strong>A simulation of <em>this</em> drive in <em>your</em> car.</strong> Every metre of
climb and descent, the air you push through at the speed you will hold, and the weather
forecast for the hour you will be at each point — ending in the number that matters: the
charge you will have left when you arrive.</p>
<p>It finds the chargers along the way, works out the fewest stops that get you there with
the charge you asked to arrive with, and hands the route to your maps app.</p>
<h2>What it does not know</h2>
<p>Every figure is an estimate. It has never seen your car, your right foot or the traffic
on the day, and charger databases go out of date. Keep the safety margin, and check a
charging stop before you depend on it.</p>
<h2>Legal</h2>
<ul><li><a href="privacy.html">Privacy policy</a> — no account, no server, nothing sent to us</li>
<li><a href="terms.html">Terms of use</a></li></ul>
<h2>Contact</h2>
<p><a href="mailto:''' + CONTACT + '''">''' + CONTACT + '''</a></p>
''', 'index.html'), encoding='utf-8')
(docs/'.nojekyll').write_text('', encoding='utf-8')
print('   docs/index.html, privacy.html, terms.html written')
PY2

SHA=$(shasum -a 256 app/src/main/assets/index.html | cut -d' ' -f1)
BYTES=$(wc -c < app/src/main/assets/index.html | tr -d ' ')
VER=$(grep -oE 'versionName *= *"[^"]+"' app/build.gradle.kts | head -1 | sed 's/.*"\(.*\)"/\1/')
CODE=$(grep -oE 'versionCode *= *[0-9]+' app/build.gradle.kts | head -1 | grep -oE '[0-9]+')
printf 'EVRoute %s (%s) — built %s\n\nplanner sha256   %s\nplanner bytes    %s\n' \
  "$VER" "$CODE" "$(date +%F)" "$SHA" "$BYTES" > BUILD.txt

# a bundled key must never reach git through the source file
if grep -q "__GOOGLE_MAPS_KEY__" "$SRC" && grep -q "__ORS_KEY__" "$SRC" \
   && grep -q "__BUILD_ID__" "$SRC" && grep -q "__TERMS_HTML__" "$SRC"; then
  echo "✓  source still holds the placeholder (nothing secret committed)"
else
  echo "!! web/index.html no longer has the placeholder — a key may have leaked into the source" >&2
  exit 1
fi
echo "done."
