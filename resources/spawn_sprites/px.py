"""Tiny pixel-art toolkit for 64x64 map sprites in the Wilderstep style.

Shapes are drawn as masks, shaded from a top-left light with a little
per-pixel noise (the textured look of the existing map art), then the
whole silhouette gets a 1px near-black outline.
"""
import math
import random

import numpy as np
from PIL import Image

S = 64
OUTLINE = (2, 2, 4)


def hx(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def ramp(*hs):
    return [hx(h) for h in hs]


# Palette pulled from the existing map/settlements sprites (plus a few
# accents for magic / demon / spectral glows).
STONE = ramp("#343a4d", "#465068", "#68666e", "#8a7c74", "#b49778", "#d8b17e")
SAND = ramp("#644d48", "#8a7c74", "#b49778", "#d8b17e", "#f4d489", "#f8eab0")
GREY = ramp("#1f2433", "#343a4d", "#465068", "#68666e", "#8a8a94", "#b9cdce")
DARKROCK = ramp("#14141c", "#1f2433", "#343a4d", "#465068", "#68666e")
WOOD = ramp("#2a1a14", "#472d23", "#733c28", "#9e502f", "#ac7944")
HIDE = ramp("#472d23", "#733c28", "#9e502f", "#ac7944", "#d8b17e")
DIRT = ramp("#2a1a14", "#472d23", "#644d48", "#733c28", "#8a7c74")
ORANGE = ramp("#733c28", "#9e502f", "#d56730", "#ec8f3e", "#f8bc4e")
FIRE = ramp("#9e502f", "#d56730", "#ec8f3e", "#f8bc4e", "#f0ef49", "#f8eab0")
GREEN = ramp("#1f261d", "#2b4f28", "#486322", "#5b7d26", "#739127", "#93a729", "#b7c228", "#d2d733")
DEADGRASS = ramp("#472d23", "#644d48", "#8a7c74", "#ac7944", "#b49778")
BONE = ramp("#8a7c74", "#b49778", "#d8b17e", "#f8eab0", "#f3f3e8")
SPECTRAL = ramp("#1a4161", "#467498", "#74a3bb", "#b9cdce", "#f3f3e8")
NECRO = ramp("#114938", "#1f6b4c", "#538d46", "#a7bc4e", "#d2f0a0")
PURPLE = ramp("#1e1029", "#3b1f4f", "#5e2f78", "#8a46a8", "#b97bd6", "#e8c3f2")
RED = ramp("#2a0b0e", "#5a1418", "#8f2420", "#c43a28", "#ec5a2e", "#f8bc4e")
CYAN = ramp("#0f2a3d", "#1a4161", "#2f7fa0", "#5cc3d6", "#a8eef0", "#f3f3e8")
WEB = ramp("#b9cdce", "#f3f3e8")
GOLD = ramp("#733c28", "#ac7944", "#f8bc4e", "#f0ef49", "#f8eab0")


class Canvas:
    def __init__(self, seed):
        self.px = np.zeros((S, S, 4), dtype=np.uint8)
        self.rng = random.Random(seed)
        # Pixels that are "emissive" (glows) — exempt from outline darkening.
        self.yy, self.xx = np.mgrid[0:S, 0:S]
        # Chunky texture: noise mostly constant over 2x2 blocks (the
        # existing art reads as ~2px clusters), plus a little per-pixel.
        blk = np.array([[self.rng.uniform(-1, 1) for _ in range(S // 2)] for _ in range(S // 2)])
        self.nfield = np.kron(blk, np.ones((2, 2))) * 0.75

    # ── low-level ──────────────────────────────────────────────────
    def put(self, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < S and 0 <= y < S:
            self.px[y, x, :3] = c
            self.px[y, x, 3] = 255

    def noise(self):
        return self.rng.uniform(-1, 1)

    def fill_mask(self, mask, colors, light=None, noise=0.18, bands=None):
        """Fill `mask` choosing from `colors` (dark→light) by `light`
        (array 0..1) plus noise."""
        n = len(colors)
        ys, xs = np.nonzero(mask)
        for y, x in zip(ys, xs):
            l = 0.5 if light is None else light[y, x]
            l += (self.nfield[y, x] + self.noise() * 0.35) * noise
            i = int(max(0, min(n - 1, math.floor(l * n))))
            self.px[y, x, :3] = colors[i]
            self.px[y, x, 3] = 255

    # ── masks ──────────────────────────────────────────────────────
    def ellipse_mask(self, cx, cy, rx, ry):
        return ((self.xx + 0.5 - cx) / rx) ** 2 + ((self.yy + 0.5 - cy) / ry) ** 2 <= 1.0

    def poly_mask(self, pts):
        """Even-odd point-in-polygon on pixel centres."""
        m = np.zeros((S, S), dtype=bool)
        n = len(pts)
        X = self.xx + 0.5
        Y = self.yy + 0.5
        j = n - 1
        for i in range(n):
            xi, yi = pts[i]
            xj, yj = pts[j]
            cond = ((yi > Y) != (yj > Y)) & (
                X < (xj - xi) * (Y - yi) / ((yj - yi) if yj != yi else 1e-9) + xi
            )
            m ^= cond
            j = i
        return m

    def rect_mask(self, x0, y0, x1, y1):
        return (self.xx >= x0) & (self.xx <= x1) & (self.yy >= y0) & (self.yy <= y1)

    # ── lighting fields ────────────────────────────────────────────
    def sphere_light(self, cx, cy, rx, ry, bias=0.15):
        nx = (self.xx + 0.5 - cx) / rx
        ny = (self.yy + 0.5 - cy) / ry
        return np.clip(0.5 - 0.45 * nx - 0.55 * ny + bias, 0, 0.999)

    def box_light(self, x0, y0, x1, y1, bias=0.0):
        nx = (self.xx + 0.5 - x0) / max(1, x1 - x0)
        ny = (self.yy + 0.5 - y0) / max(1, y1 - y0)
        return np.clip(0.85 - 0.55 * nx - 0.3 * ny + bias, 0, 0.999)

    # ── composite helpers ──────────────────────────────────────────
    def blob(self, cx, cy, rx, ry, colors, bias=0.1, noise=0.2):
        m = self.ellipse_mask(cx, cy, rx, ry)
        self.fill_mask(m, colors, self.sphere_light(cx, cy, rx, ry, bias), noise)
        return m

    def poly(self, pts, colors, light=None, noise=0.18, bias=0.0):
        m = self.poly_mask(pts)
        if light is None:
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            light = self.box_light(min(xs), min(ys), max(xs), max(ys), bias)
        self.fill_mask(m, colors, light, noise)
        return m

    def box(self, x0, y0, x1, y1, colors, bias=0.0, noise=0.18):
        m = self.rect_mask(x0, y0, x1, y1)
        self.fill_mask(m, colors, self.box_light(x0, y0, x1, y1, bias), noise)
        return m

    def line(self, x0, y0, x1, y1, c, w=1):
        steps = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(steps + 1):
            t = i / max(1, steps)
            x = x0 + (x1 - x0) * t
            y = y0 + (y1 - y0) * t
            for dx in range(w):
                self.put(x + dx, y, c)

    def boulder(self, cx, cy, r, colors=STONE, moss=0.0, squash=0.8):
        self.blob(cx, cy, r, r * squash, colors, bias=0.12, noise=0.22)
        if moss > 0:
            self.moss_on(cx, cy, r, r * squash, moss)

    def moss_on(self, cx, cy, rx, ry, amount):
        """Sprinkle moss on the upper surface of an ellipse."""
        for y in range(int(cy - ry), int(cy + 1)):
            for x in range(int(cx - rx), int(cx + rx) + 1):
                if not (0 <= x < S and 0 <= y < S) or self.px[y, x, 3] == 0:
                    continue
                d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2
                if d > 1:
                    continue
                top = 1 - (y - (cy - ry)) / ry  # 1 at top
                if self.rng.random() < amount * top * 1.4:
                    self.put(x, y, self.rng.choice(GREEN[3:]))

    def ground(self, x0=3, x1=60, y=61, colors=GREEN, rocks=True, h=3, rock_colors=STONE):
        """Mossy rock + grass strip along the base (like ruins/cave)."""
        for x in range(x0, x1 + 1):
            hh = h + (1 if self.rng.random() < 0.4 else 0)
            for k in range(hh):
                yy = y - k
                l = 0.25 + 0.6 * (k / max(1, hh - 1)) + self.noise() * 0.2
                i = int(max(0, min(len(colors) - 1, l * len(colors))))
                self.put(x, yy, colors[i])
        if rocks:
            x = x0 + 1
            while x < x1 - 1:
                r = self.rng.uniform(1.6, 2.8)
                self.boulder(x + r, y - 1, r, rock_colors, moss=0.5, squash=0.75)
                x += r * 2 + self.rng.randint(1, 6)

    def tuft(self, x, y, colors=GREEN, h=3):
        for k in range(h):
            self.put(x, y - k, colors[min(len(colors) - 1, 3 + k)])
        self.put(x - 1, y - 1, colors[4])
        self.put(x + 1, y - 1, colors[5])

    def glow(self, cx, cy, r, colors, density=1.0):
        """Soft radial glow drawn with discrete rings (no alpha)."""
        for y in range(int(cy - r), int(cy + r) + 1):
            for x in range(int(cx - r), int(cx + r) + 1):
                d = math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r
                if d > 1 or self.rng.random() > density:
                    continue
                l = 1 - d + self.noise() * 0.12
                i = int(max(0, min(len(colors) - 1, l * len(colors))))
                self.put(x, y, colors[i])

    def outline(self, color=OUTLINE):
        a = self.px[..., 3] > 0
        o = np.zeros_like(a)
        o[1:, :] |= a[:-1, :]
        o[:-1, :] |= a[1:, :]
        o[:, 1:] |= a[:, :-1]
        o[:, :-1] |= a[:, 1:]
        o &= ~a
        self.px[o, :3] = color
        self.px[o, 3] = 255

    def save(self, path):
        Image.fromarray(self.px, "RGBA").save(path)
