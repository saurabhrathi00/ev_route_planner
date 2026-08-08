#!/usr/bin/env python3
"""Cuts the app icon out of the artwork and lays it out for each place it goes.

    python3 tools/make-icons.py

The file in brand/ is a picture of an icon rather than an icon: the logo sits on
a cream rounded panel, the panel has a drop shadow, and the whole thing is
centred on a white page with a wide margin. About 55% of the file is the mark
and the rest is presentation. Shipped as it stands it would be rounded twice —
both stores mask corners that are already drawn in — and Android's adaptive icon
would crop a circle out of what remained, so the mark would arrive small, inset,
and clipped where the corners had been.

So the mark is found, lifted off its page, and re-laid full-bleed at the
proportion each target wants:

  stores      78% of the square, near enough to how it sits on the panel in the
              source, on the panel's own cream, no transparency, no corners
  launcher    58%, because Android guarantees only the middle 66 of 108 units;
              anything outside that circle may be cropped on some device

The launcher copy also loses the road markings. They are the first thing to go
at 48dp — a dash is about half a pixel there, and fourteen of them turn a road
into a chain. That was measured on three different drawings before it was
believed. The store icons keep them, because at 512 they are the best thing
about the artwork.

There is no imaging library on this machine, so the PNG is decoded and written
here, and the one morphological pass runs on the launcher sizes only: the
largest is 432 pixels and there is nothing to be gained closing dashes at 1254.
"""
import struct, zlib, pathlib

SOURCE      = 'brand'        # whatever PNG is in here; the name has changed twice
STORE_FILL  = 0.78          # how much of the square the mark occupies
LAUNCH_FILL = 0.58          # inside the 66/108 circle Android promises to show
INK_MAX_LUM = 195           # lighter than this is page, panel or shadow


# ---------------------------------------------------------------- png

def load(path):
    raw = pathlib.Path(path).read_bytes()
    pos, idat, hdr = 8, b'', None
    while pos < len(raw):
        ln = struct.unpack('>I', raw[pos:pos+4])[0]
        typ = raw[pos+4:pos+8]
        d = raw[pos+8:pos+8+ln]
        if typ == b'IHDR':
            hdr = struct.unpack('>IIBBBBB', d)
        elif typ == b'IDAT':
            idat += d
        pos += 12 + ln
    w, h, depth, ct = hdr[0], hdr[1], hdr[2], hdr[3]
    if depth != 8 or ct not in (2, 6):
        raise SystemExit(f'{path}: expected 8-bit RGB or RGBA, got depth {depth} type {ct}')
    bpp = 3 if ct == 2 else 4
    px = zlib.decompress(idat)
    stride = w * bpp
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(h):
        f = px[i]; i += 1
        line = bytearray(px[i:i+stride]); i += stride
        for x in range(stride):
            a = line[x-bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x-bpp] if x >= bpp else 0
            if   f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a+b)//2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        rows.append(line); prev = line
    return w, h, bpp, rows


def _png(path, size, data, colour_type, chan):
    raw = b''.join(b'\x00' + bytes(data[y*size*chan:(y+1)*size*chan]) for y in range(size))
    def chunk(t, d):
        return (struct.pack('>I', len(d)) + t + d
                + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff))
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, colour_type, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
    p = pathlib.Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(png)
    print(f'  {p}  {size}x{size}  {len(png)/1024:.1f} KB')


def write_rgb(path, size, data):  _png(path, size, data, 2, 3)
def write_rgba(path, size, data): _png(path, size, data, 6, 4)


# ---------------------------------------------------------------- the mark

def lum(r, g, b):
    return 0.2126*r + 0.7152*g + 0.0722*b


def find_mark(w, h, bpp, rows):
    """Where the drawing is, and the colour of the panel behind it."""
    L = T = None; R = B = 0
    for y in range(h):
        row = rows[y]
        for x in range(w):
            o = x*bpp
            if lum(row[o], row[o+1], row[o+2]) < INK_MAX_LUM:
                if T is None: T = y
                B = y
                L = x if L is None else min(L, x)
                R = max(R, x)
    if L is None:
        raise SystemExit('nothing in the artwork is dark enough to be a mark')
    py, px_ = min(h-1, T + 40), max(0, L - 40)
    o = px_*bpp
    return (L, T, R, B), (rows[py][o], rows[py][o+1], rows[py][o+2])


def compose(size, src, box, ground, fill, ss=3, drop_dashes=False, alpha=False):
    """The mark, centred on `ground`, occupying `fill` of the square.

    Every source pixel under an output pixel is averaged, rather than one of
    them being picked. A 649-pixel mark going to 108 means ten source pixels per
    output pixel in each direction: choosing one of the hundred and discarding
    the rest is what put speckle across the road, and it looked enough like
    compression noise that I first went after the artwork instead of the
    sampling.
    """
    w, h, bpp, rows = src
    L, T, R, B = box
    span = max(R-L+1, B-T+1)
    inner = max(1, int(round(size * fill)))          # the mark, in output pixels
    step = span / inner                              # source pixels per output pixel
    cx, cy = (L+R)/2, (T+B)/2
    x0, y0 = cx - span/2, cy - span/2

    grid = bytearray(inner*inner*4)
    for oy in range(inner):
        sy0, sy1 = y0 + oy*step, y0 + (oy+1)*step
        iy0, iy1 = max(0, int(sy0)), min(h, int(sy1) + 1)
        for ox in range(inner):
            sx0, sx1 = x0 + ox*step, x0 + (ox+1)*step
            ix0, ix1 = max(0, int(sx0)), min(w, int(sx1) + 1)
            r = g = b = 0; hits = 0; ink = 0
            for yy in range(iy0, iy1):
                row = rows[yy]
                for xx in range(ix0, ix1):
                    o = xx*bpp
                    pr, pg, pb = row[o], row[o+1], row[o+2]
                    hits += 1
                    if lum(pr, pg, pb) < INK_MAX_LUM:
                        r += pr; g += pg; b += pb; ink += 1
            o = (oy*inner + ox)*4
            if ink:
                grid[o:o+3] = bytes((r//ink, g//ink, b//ink))
                grid[o+3] = int(255 * ink / max(1, hits))
            else:
                grid[o:o+3] = bytes(ground)
                grid[o+3] = 0

    if drop_dashes:
        print(f'    markings closed: {close_dashes(grid, inner)}')

    # centre it on the ground
    pad = (size - inner) // 2
    chan = 4 if alpha else 3
    out = bytearray()
    for y in range(size):
        for x in range(size):
            gy, gx = y - pad, x - pad
            if 0 <= gy < inner and 0 <= gx < inner:
                o = (gy*inner + gx)*4
                a = grid[o+3]
                if alpha:
                    out += bytes((grid[o], grid[o+1], grid[o+2], a))
                else:
                    k = a / 255
                    out += bytes(int(ground[i]*(1-k) + grid[o+i]*k) for i in range(3))
            else:
                out += bytes(ground + ((0,) if alpha else ()))
    return out


def close_dashes(grid, n, radius=None):
    """Fill the road markings in.

    A dash is a light island inside the dark road. Closing the dark mask — grow
    it, then shrink it back by as much — swallows any hole narrower than the
    growth and leaves the road's outer edge where it was. The white verge
    between road and green survives, because it is not a hole: it opens onto
    the ground.
    """
    if radius is None:
        radius = max(3, n // 110)
    dark = bytearray(n*n)
    for i in range(n*n):
        o = i*4
        if grid[o+3] and lum(grid[o], grid[o+1], grid[o+2]) < 150:
            dark[i] = 1

    def pass_(src, grow):
        """Dilate or erode, separably: rows then columns."""
        tmp = bytearray(n*n)
        for y in range(n):
            base = y*n
            run = sum(src[base:base+min(radius, n)])
            for x in range(n):
                add = x + radius
                sub = x - radius - 1
                if x:
                    if add < n: run += src[base+add]
                    if sub >= 0: run -= src[base+sub]
                width = min(n-1, x+radius) - max(0, x-radius) + 1
                tmp[base+x] = 1 if (run > 0 if grow else run == width) else 0
        out = bytearray(n*n)
        for x in range(n):
            run = sum(tmp[y*n+x] for y in range(min(radius, n)))
            for y in range(n):
                add = y + radius
                sub = y - radius - 1
                if y:
                    if add < n: run += tmp[add*n+x]
                    if sub >= 0: run -= tmp[sub*n+x]
                height = min(n-1, y+radius) - max(0, y-radius) + 1
                out[y*n+x] = 1 if (run > 0 if grow else run == height) else 0
        return out

    closed = pass_(pass_(dark, True), False)

    # the road's own colour, taken from the road rather than guessed
    tally = {}
    for i in range(0, n*n, 7):
        if dark[i]:
            o = i*4
            key = (grid[o] >> 3, grid[o+1] >> 3, grid[o+2] >> 3)
            tally[key] = tally.get(key, 0) + 1
    if not tally:
        return
    k = max(tally, key=tally.get)
    road = bytes(((k[0] << 3) + 4, (k[1] << 3) + 4, (k[2] << 3) + 4))

    filled = 0
    for i in range(n*n):
        if closed[i] and not dark[i]:
            o = i*4
            grid[o:o+3] = road
            grid[o+3] = 255
            filled += 1

    # A second pass to darken pale streaks inside the road was tried and
    # reverted: green is lighter than asphalt by more than any threshold that
    # catches a marking, and closing the dark mask engulfs the thin green next
    # to the road — so the crescent went black. Averaging already softens the
    # markings to texture at these sizes, which is the outcome that was wanted.
    return filled



def find_source(root):
    d = root / SOURCE
    pngs = sorted(p for p in d.glob('*.png') if not p.name.startswith('.'))
    if not pngs:
        raise SystemExit(f'no artwork in {d} — put the icon there as a PNG')
    if len(pngs) > 1:
        raise SystemExit(f'{d} holds {len(pngs)} PNGs; leave the one to use:\n  '
                         + '\n  '.join(p.name for p in pngs))
    return pngs[0]


if __name__ == '__main__':
    root = pathlib.Path(__file__).resolve().parent.parent
    art = find_source(root)
    print(f'  from {art.relative_to(root)}')
    src = load(art)
    w, h, bpp, rows = src
    box, ground = find_mark(w, h, bpp, rows)
    L, T, R, B = box
    print(f'  source {w}x{h}; the mark is {R-L+1}x{B-T+1} at {L},{T} '
          f'— {(R-L+1)/w*100:.0f}% of the file, the rest is page and panel')
    print('  ground #%02X%02X%02X' % ground)

    for path, size in (('web/icons/icon-1024-playstore.png', 1024),
                       ('web/icons/icon-512.png', 512),
                       ('web/icons/icon-192.png', 192),
                       ('ios/Assets.xcassets/AppIcon.appiconset/icon-1024.png', 1024)):
        write_rgb(root / path, size,
                  compose(size, src, box, ground, STORE_FILL))

    # Android: a bitmap foreground with the markings closed, over a flat ground.
    for folder, size in (('mipmap-mdpi', 108), ('mipmap-hdpi', 162),
                         ('mipmap-xhdpi', 216), ('mipmap-xxhdpi', 324),
                         ('mipmap-xxxhdpi', 432)):
        write_rgba(root / f'app/src/main/res/{folder}/ic_launcher_foreground.png', size,
                   compose(size, src, box, ground, LAUNCH_FILL,
                           drop_dashes=True, alpha=True))

    old = root / 'app/src/main/res/drawable/ic_launcher_foreground.xml'
    if old.exists():
        old.unlink()
        print(f'  removed {old.name} — the foreground is a bitmap now')

    (root / 'app/src/main/res/values/icon_ground.xml').write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        '    <!-- the panel colour taken out of brand/, so the adaptive icon\'s\n'
        '         background matches the artwork instead of approximating it -->\n'
        '    <color name="icon_ground">#%02X%02X%02X</color>\n</resources>\n' % ground,
        encoding='utf-8')
    print('  app/src/main/res/values/icon_ground.xml')
