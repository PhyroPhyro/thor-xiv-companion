#!/usr/bin/env python3
"""Gera icone PNG do launcher sem dependencias (so stdlib)."""
import struct, zlib

W = H = 192
BG = (10, 14, 20)
GOLD = (207, 176, 97)
DARK = (34, 48, 68)

def setpx(px, x, y, rgba):
    if 0 <= x < W and 0 <= y < H:
        px[y][x] = rgba

def main():
    px = [[BG for _ in range(W)] for _ in range(H)]
    # cantos arredondados: fora do raio de arredondamento -> transparente
    rad = 36
    def corner_outside(x, y):
        cx = min(x, W - 1 - x)
        cy = min(y, H - 1 - y)
        if cx >= rad or cy >= rad:
            return False
        dx, dy = rad - cx, rad - cy
        return dx * dx + dy * dy > rad * rad

    for y in range(H):
        for x in range(W):
            if corner_outside(x, y):
                px[y][x] = (0, 0, 0, 0)

    cx, cy, r = 96, 84, 52
    for y in range(H):
        for x in range(W):
            d2 = (x - cx) ** 2 + (y - cy) ** 2
            if 43 * 43 < d2 < 49 * 49:
                px[y][x] = GOLD

    # estrela de Hydaelyn simplificada (losango)
    pts = [(96, 52), (104, 76), (128, 82), (104, 90), (96, 116), (88, 90), (64, 82), (88, 76)]
    for yy in range(50, 118):
        for xx in range(62, 130):
            if inside(pts, xx, yy):
                px[yy][xx] = GOLD

    # barra "thor" inferior
    for y in range(148, 158):
        for x in range(40, 152):
            if 40 <= x < 152:
                px[y][x] = DARK

    rows = b""
    for y in range(H):
        rows += b"\x00" + b"".join(bytes(c) if len(c) == 4 else bytes(c) + b"\xff" for c in px[y])

    def chunk(t, d):
        c = t + d
        return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(rows, 9))
    png += chunk(b"IEND", b"")
    open(__import__("sys").argv[1] if len(__import__("sys").argv) > 1 else "ic_launcher.png", "wb").write(png)

def inside(poly, x, y):
    n = len(poly)
    res = False
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[(i + 1) % n]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            res = not res
    return res

main()
