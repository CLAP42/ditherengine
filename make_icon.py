#!/usr/bin/env python3
"""Generate icon_1024.png for Dither Engine — a Bayer-dithered orb on a CRT squircle.
Pure stdlib (zlib), no Pillow needed."""
import zlib, struct, math

W = H = 1024

# --- palette (neon / CRT) ---
CYAN    = (0x19, 0xf0, 0xff)   # highlight
MAGENTA = (0xff, 0x2b, 0xd6)   # shadow
TILE_TOP = (0x0c, 0x0c, 0x1e)
TILE_BOT = (0x05, 0x05, 0x0c)
RING     = (0x2b, 0xff, 0xe6)

# Bayer 8x8 ordered-dither matrix, normalized to (0,1)
_B8 = [
    [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
]
CELL = 16  # chunky dither: each Bayer cell is CELLxCELL px -> visible retro dots
def bayer(x, y):
    return (_B8[(y // CELL) & 7][(x // CELL) & 7] + 0.5) / 64.0

def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))

# squircle (superellipse) mask params
PAD = 70
L, T = PAD, PAD
R, B = W - PAD, H - PAD
cx2, cy2 = (L + R) / 2, (T + B) / 2
ax, ay = (R - L) / 2, (B - T) / 2
N = 5.0  # superellipse exponent -> rounded squircle

def in_tile(x, y):
    u = abs((x - cx2) / ax)
    v = abs((y - cy2) / ay)
    return (u ** N + v ** N) <= 1.0

# orb
ocx, ocy, orad = W / 2, H / 2, 300.0
# light direction (top-left, slightly toward viewer)
lx, ly, lz = -0.5, -0.6, 0.62
ln = math.sqrt(lx*lx + ly*ly + lz*lz)
lx, ly, lz = lx/ln, ly/ln, lz/ln

rows = bytearray()
for y in range(H):
    rows.append(0)  # PNG filter type 0 for this scanline
    for x in range(W):
        if not in_tile(x, y):
            rows += bytes((0, 0, 0, 0))  # transparent outside squircle
            continue
        # tile background: vertical gradient + faint scanlines
        gt = (y - T) / (B - T)
        r, g, b = lerp(TILE_TOP, TILE_BOT, max(0.0, min(1.0, gt)))
        if (y % 4) < 1:
            r, g, b = int(r*0.82), int(g*0.82), int(b*0.82)
        a = 255

        dx, dy = (x - ocx) / orad, (y - ocy) / orad
        d2 = dx*dx + dy*dy
        if d2 <= 1.0:
            # diagonal ramp top-left (cyan) -> bottom-right (magenta)
            t = (dx + dy) / 2.0            # -1..1
            t = t * 0.5 + 0.5             # gentle ramp: visible dither across whole orb
            t = max(0.0, min(1.0, t))
            # 1-bit ordered dither between CYAN (t low) and MAGENTA (t high)
            col = MAGENTA if t > bayer(x, y) else CYAN
            r, g, b = col
        elif d2 <= 1.10:
            # neon rim ring
            edge = 1.0 - abs(d2 - 1.05) / 0.05
            r, g, b = lerp((r, g, b), RING, max(0.0, edge) * 0.7)
        rows += bytes((r, g, b, a))

def chunk(typ, data):
    c = struct.pack(">I", len(data)) + typ + data
    return c + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)

png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))  # 8-bit RGBA
png += chunk(b"IDAT", zlib.compress(bytes(rows), 9))
png += chunk(b"IEND", b"")
open("icon_1024.png", "wb").write(png)
print("wrote icon_1024.png", len(png), "bytes")
