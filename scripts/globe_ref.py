"""
Renders the reference GLOBE ARTWORK as a PNG so the globe can be matched
numerically (radius, filament density, limb bloom radius, background tile
pitch) instead of by eye.

This is a measurement target, NOT the original file: it is our reconstruction
of docs/reference/globe-reference.png. When the real file is dropped in, prefer
that file for measurement.

usage: python scripts/globe_ref.py [out.png]
"""
import math
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

W, H = 289, 259
S = 3  # supersample for clean edges
w, h = W * S, H * S

img = Image.new("RGB", (w, h), (2, 10, 8))
d = ImageDraw.Draw(img, "RGBA")

cx, cy = w // 2, h // 2
R = int(h * 0.315)  # sphere radius

# ── background: zoomed dot-matrix world plane ────────────────────────────────
rng = random.Random(7)
pitch = 13 * S
for gy in range(0, h, pitch):
    for gx in range(0, w, pitch):
        # tiles are denser/brighten toward the outer frame
        dx, dy = (gx - cx) / w, (gy - cy) / h
        edge = min(1.0, math.hypot(dx, dy) * 1.5)
        a = int(46 * edge + rng.randint(0, 26))
        r = max(1, int(1.1 * S))
        d.ellipse([gx - r, gy - r, gx + r, gy + r], fill=(60, 200, 130, a))

# corner dot clusters (the artwork has bright blocks in the corners)
for _ in range(900):
    x = rng.choice([rng.randint(0, w // 3), rng.randint(2 * w // 3, w)])
    y = rng.choice([rng.randint(0, h // 3), rng.randint(2 * h // 3, h)])
    r = max(1, int(rng.uniform(0.7, 1.8) * S))
    d.ellipse([x - r, y - r, x + r, y + r], fill=(120, 255, 180, rng.randint(30, 110)))

# ── concentric arc rings around the globe ───────────────────────────────────
for ring_r, alpha, width in (
    (R * 1.55, 60, 2),
    (R * 1.72, 40, 2),
    (R * 1.92, 30, 2),
    (R * 1.18, 26, 1),
):
    rr = int(ring_r)
    for start in range(0, 360, 47):
        d.arc(
            [cx - rr, cy - rr, cx + rr, cy + rr],
            start=start,
            end=start + rng.randint(24, 62),
            fill=(90, 240, 160, alpha),
            width=width * S,
        )

# ── wandering dashed network lines across the plane ─────────────────────────
for _ in range(22):
    x, y = rng.uniform(0, w), rng.uniform(0, h)
    pts = [(x, y)]
    ang = rng.uniform(0, math.tau)
    for _ in range(rng.randint(6, 14)):
        ang += rng.uniform(-0.7, 0.7)
        step = rng.uniform(0.05, 0.13) * w
        x += math.cos(ang) * step
        y += math.sin(ang) * step
        pts.append((x, y))
    d.line(pts, fill=(70, 230, 150, rng.randint(28, 70)), width=S)

# ── the globe: soft outer bloom, then dense filament tangle ─────────────────
# limb bloom
glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
for i in range(16):
    rr = int(R * (1.04 + i * 0.055))
    a = int(30 * (1 - i / 16) ** 2)
    gd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(70, 255, 160, a))
img = Image.alpha_composite(img.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(9 * S)))
d = ImageDraw.Draw(img, "RGBA")

# sphere bed
d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(8, 34, 24, 235))

# filaments: only draw inside the sphere
sphere_mask = Image.new("L", (w, h), 0)
ImageDraw.Draw(sphere_mask).ellipse([cx - R, cy - R, cx + R, cy + R], fill=255)

fil = Image.new("RGBA", (w, h), (0, 0, 0, 0))
fd = ImageDraw.Draw(fil, "RGBA")
for _ in range(900):
    while True:
        x = rng.uniform(cx - R, cx + R)
        y = rng.uniform(cy - R, cy + R)
        if math.hypot(x - cx, y - cy) < R * 0.99:
            break
    pts = [(x, y)]
    ang = rng.uniform(0, math.tau)
    for _ in range(rng.randint(4, 11)):
        ang += rng.uniform(-1.1, 1.1)
        step = rng.uniform(0.03, 0.09) * R
        x += math.cos(ang) * step
        y += math.sin(ang) * step
        pts.append((x, y))
    v = rng.randint(190, 255)
    fd.line(pts, fill=(v, 255, v, rng.randint(70, 175)), width=max(1, int(rng.uniform(0.5, 1.6) * S)))

# nodes
for _ in range(260):
    a = rng.uniform(0, math.tau)
    rr = rng.uniform(0, R * 0.96)
    x, y = cx + math.cos(a) * rr, cy + math.sin(a) * rr
    rad = rng.uniform(1.0, 2.6) * S
    fd.ellipse([x - rad, y - rad, x + rad, y + rad], fill=(230, 255, 245, rng.randint(140, 255)))

fil.putalpha(Image.composite(fil.getchannel("A"), Image.new("L", (w, h), 0), sphere_mask))
img = Image.alpha_composite(img, fil)
d = ImageDraw.Draw(img, "RGBA")

# bright limb ring
d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=(200, 255, 230, 120), width=int(1.4 * S))

# drifting spark particles outside the sphere
for _ in range(60):
    a = rng.uniform(0, math.tau)
    rr = rng.uniform(R * 1.05, R * 1.9)
    x, y = cx + math.cos(a) * rr, cy + math.sin(a) * rr
    rad = rng.uniform(0.8, 2.2) * S
    d.ellipse([x - rad, y - rad, x + rad, y + rad], fill=(190, 255, 220, rng.randint(40, 120)))

out = img.convert("RGB").resize((W, H), Image.LANCZOS)
path = sys.argv[1] if len(sys.argv) > 1 else "docs/reference/globe-artwork-target.png"
out.save(path)
print("wrote", path, out.size, "sphere radius", round(R / S, 1))
