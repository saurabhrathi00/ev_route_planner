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
def md_to_html(path):
    import html as _h
    out, lines = [], open(path, encoding='utf-8').read().split('\n')
    i, in_ul, in_tbl = 0, False, False
    def inline(t):
        t = _h.escape(t)
        # A link to another markdown file is useful in the repository and dead
        # on a phone, where the file does not exist. The words survive; the
        # link does not.
        t = re.sub(r'\[([^\]]+)\]\((?![a-z]+:)[^)]*\.md[^)]*\)', r'\1', t)
        t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)',
                   lambda m: f'<a href="{m.group(2)}" target="_blank" rel="noopener">{m.group(1)}</a>', t)
        t = re.sub(r'<(https?://[^>]+)>', r'<a href="\1">\1</a>', t)
        t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
        t = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<em>\1</em>', t)
        return t
    def shut():
        nonlocal in_ul, in_tbl
        if in_ul: out.append('</ul>'); in_ul = False
        if in_tbl: out.append('</tbody></table></div>'); in_tbl = False
    while i < len(lines):
        ln = lines[i].rstrip(); i += 1
        if not ln.strip():
            shut(); continue
        if ln.startswith('## '):
            shut(); out.append('<h2>' + inline(ln[3:]) + '</h2>'); continue
        if ln.startswith('# '):
            shut(); out.append('<h1>' + inline(ln[2:]) + '</h1>'); continue
        if ln.startswith('---'):
            shut(); out.append('<hr>'); continue
        if ln.startswith('- '):
            if not in_ul: shut(); out.append('<ul>'); in_ul = True
            out.append('<li>' + inline(ln[2:]) + '</li>'); continue
        if ln.startswith('|'):
            cells = [c.strip() for c in ln.strip('|').split('|')]
            if set(''.join(cells)) <= set('-: '):          # the header rule
                continue
            if not in_tbl:
                shut()
                out.append('<div class="docwrap"><table><thead><tr>'
                           + ''.join('<th>' + inline(c) + '</th>' for c in cells)
                           + '</tr></thead><tbody>')
                in_tbl = True
                continue
            out.append('<tr>' + ''.join('<td>' + inline(c) + '</td>' for c in cells) + '</tr>')
            continue
        shut(); out.append('<p>' + inline(ln) + '</p>')
    shut()
    return '\n'.join(out)

STAMPS = {'__GOOGLE_MAPS_KEY__': key, '__ORS_KEY__': ors,
          '__TERMS_HTML__': md_to_html('TERMS.md'),
          '__PRIVACY_HTML__': md_to_html('PRIVACY.md'),
          '__BUILD_VER__': ver, '__BUILD_CODE__': code, '__BUILD_DATE__': date,
          '__BUILD_ID__': 'v%s (%s)' % (ver, code)}
for token in STAMPS:
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
