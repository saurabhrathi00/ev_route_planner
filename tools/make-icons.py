#!/usr/bin/env python3
"""Draws the app icon, everywhere it is needed, from one description of it.

    python3 tools/make-icons.py

The old icon was a terrain profile with a charge curve falling across it: four
and five pixel strokes in muted grey and blue on an off-white ground. At the
size a launcher actually draws it — 48dp, and an adaptive icon crops to a
circle inside that — the lines thinned to nothing and the whole thing read as a
smudge. It was a picture of what the app does, at a size where a picture cannot
be read.

This is one shape instead: an S bent like a ghat road, white on the brand
green. It is the initial of the name and the shape of the road the app is for,
and it survives being 48 pixels wide, which is the only test that matters.

No imaging library — the machine has none, and an icon generator that needs one
installed is a generator nobody runs. The curve is stroked by stamping a disc
along it, which is exactly what a round cap and join are, and the whole thing is
drawn at four times the size and averaged down for the edges.
"""
import struct, zlib, pathlib, sys

GREEN = (0x1D, 0x87, 0x24)          # --brand-green, light theme
WHITE = (0xFF, 0xFF, 0xFF)

# The road, in a 108-unit box — the Android adaptive icon's viewport. Content
# keeps inside the middle 66 units, because that circle is all a launcher is
# guaranteed to show.
STROKE = 12.5
CURVES = [
    ((70.0, 33.0), (70.0, 22.5), (41.0, 23.0), (41.0, 39.0)),
    ((41.0, 39.0), (41.0, 52.5), (68.0, 55.5), (68.0, 70.0)),
    ((68.0, 70.0), (68.0, 85.0), (39.0, 85.5), (38.5, 75.0)),
]


def bezier(p0, p1, p2, p3, t):
    u = 1 - t
    return (u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0],
            u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1])


def render(size, bg, fg, ss=4):
    """The icon at `size`, supersampled by `ss` and averaged down."""
    n = size * ss
    scale = n / 108.0
    r = STROKE / 2 * scale
    r2 = r * r
    ink = bytearray([0]) * (n * n)          # coverage mask

    pts = []
    for c in CURVES:
        steps = max(60, int(120 * scale / 4))
        pts += [bezier(*c, i / steps) for i in range(steps + 1)]

    for (x, y) in pts:
        cx, cy = x * scale, y * scale
        x0, x1 = max(0, int(cx - r) - 1), min(n - 1, int(cx + r) + 1)
        y0, y1 = max(0, int(cy - r) - 1), min(n - 1, int(cy + r) + 1)
        for yy in range(y0, y1 + 1):
            dy = yy + 0.5 - cy
            dy2 = dy * dy
            if dy2 > r2:
                continue
            row = yy * n
            for xx in range(x0, x1 + 1):
                dx = xx + 0.5 - cx
                if dx * dx + dy2 <= r2:
                    ink[row + xx] = 1

    out = bytearray()
    for y in range(size):
        out.append(0)                        # PNG filter: none
        for x in range(size):
            hit = 0
            for sy in range(ss):
                row = (y * ss + sy) * n + x * ss
                for sx in range(ss):
                    hit += ink[row + sx]
            a = hit / (ss * ss)
            out += bytes(int(bg[i] + (fg[i] - bg[i]) * a + 0.5) for i in range(3))
    return bytes(out)


def write_png(path, size, raw):
    def chunk(t, d):
        return (struct.pack('>I', len(d)) + t + d
                + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff))
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
           + chunk(b'IEND', b''))
    pathlib.Path(path).write_bytes(png)
    print(f'  {path}  {size}x{size}  {len(png)/1024:.1f} KB')


VECTOR = '''<?xml version="1.0" encoding="utf-8"?>
<!-- The road as an S, and the S as a road. Drawn as a vector so the launcher
     renders it sharp at every density; tools/make-icons.py draws the same
     curve for the stores, which want pixels. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path
        android:pathData="%s"
        android:strokeColor="#FFFFFF" android:strokeWidth="%s"
        android:strokeLineCap="round" android:strokeLineJoin="round" />
</vector>
'''


def path_data():
    d = f'M{CURVES[0][0][0]},{CURVES[0][0][1]}'
    for (_, p1, p2, p3) in CURVES:
        d += f' C{p1[0]},{p1[1]} {p2[0]},{p2[1]} {p3[0]},{p3[1]}'
    return d


if __name__ == '__main__':
    root = pathlib.Path(__file__).resolve().parent.parent

    # Android: a vector foreground on a flat green background layer.
    (root / 'app/src/main/res/drawable/ic_launcher_foreground.xml').write_text(
        VECTOR % (path_data(), STROKE), encoding='utf-8')
    print('  app/src/main/res/drawable/ic_launcher_foreground.xml')

    # Everywhere that wants pixels. The adaptive icon crops; these do not, so
    # they are drawn from the same curve at the same proportions.
    for path, size in (('web/icons/icon-192.png', 192),
                       ('web/icons/icon-512.png', 512),
                       ('web/icons/icon-1024-playstore.png', 1024),
                       ('ios/Assets.xcassets/AppIcon.appiconset/icon-1024.png', 1024)):
        ss = 4 if size <= 512 else 2         # 1024 at 4x is a lot of pixels
        write_png(root / path, size, render(size, GREEN, WHITE, ss))
