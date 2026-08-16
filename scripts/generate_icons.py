#!/usr/bin/env python3
"""
generate_icons.py — pure-Python PNG icon generator (no external libraries).

Creates branded app icons (gradient background + white mortarboard glyph) for
the PWA: icons/icon-192.png, icon-512.png, maskable-512.png, apple-touch-180.png,
plus favicon-32.png.
"""

import os, zlib, struct

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "icons")
os.makedirs(OUT, exist_ok=True)

# Brand gradient (top -> bottom)
TOP = (11, 18, 32)      # #0b1220
BOT = (37, 99, 235)     # #2563eb
WHITE = (255, 255, 255)


def _png(path, w, h, px):
    """px: bytearray of RGBA (w*h*4). Write a minimal PNG."""
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        return c + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)  # filter type 0
        raw += px[y * stride:(y + 1) * stride]
    comp = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", comp))
        f.write(chunk(b"IEND", b""))


def _lerp(a, b, t):
    return int(round(a + (b - a) * t))


def make_icon(path, N, glyph_scale=0.66):
    px = bytearray(N * N * 4)
    cx = N / 2.0
    # glyph geometry (mortarboard: rhombus board + cap band + tassel)
    gw = N * glyph_scale                     # board full width
    hw = gw / 2.0                            # half width
    hh = hw * 0.52                           # half height (board)
    by = N * 0.44                            # board center y
    band_h = N * 0.055                       # cap band thickness
    band_top = by + hh * 0.15
    band_bot = band_top + band_h
    band_hw = hw * 0.62                      # cap band half-width (narrower)
    # tassel
    tx = cx + hw * 0.72
    t_top = by
    t_bot = by + hh + N * 0.14
    t_w = N * 0.012
    knob_r = N * 0.028
    knob_y = t_bot

    for y in range(N):
        t = y / (N - 1)
        r0 = _lerp(TOP[0], BOT[0], t)
        g0 = _lerp(TOP[1], BOT[1], t)
        b0 = _lerp(TOP[2], BOT[2], t)
        base = y * N * 4
        for x in range(N):
            white = False
            # board rhombus: |dx|/hw + |dy|/hh <= 1
            dx = abs(x - cx); dy = abs(y - by)
            if (dx / hw + dy / hh) <= 1.0:
                white = True
            # cap band (rounded-ish rectangle under board center)
            if (band_top <= y <= band_bot) and (abs(x - cx) <= band_hw):
                white = True
            # tassel line
            if (t_top <= y <= t_bot) and (abs(x - tx) <= t_w):
                white = True
            # tassel knob
            if ((x - tx) ** 2 + (y - knob_y) ** 2) <= (knob_r ** 2):
                white = True
            i = base + x * 4
            if white:
                px[i] = WHITE[0]; px[i+1] = WHITE[1]; px[i+2] = WHITE[2]; px[i+3] = 255
            else:
                px[i] = r0; px[i+1] = g0; px[i+2] = b0; px[i+3] = 255
    _png(path, N, N, px)
    print("wrote", path)


make_icon(os.path.join(OUT, "icon-192.png"), 192, 0.66)
make_icon(os.path.join(OUT, "icon-512.png"), 512, 0.66)
make_icon(os.path.join(OUT, "maskable-512.png"), 512, 0.52)  # extra safe padding
make_icon(os.path.join(OUT, "apple-touch-180.png"), 180, 0.66)
make_icon(os.path.join(OUT, "favicon-32.png"), 32, 0.72)
print("done")
