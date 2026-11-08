"""Generate PWA icons for S.A.T.U.R.N.

Draws the same visual language as the globe: a dark field with a glowing
wire sphere and a thin orbit ring. Deliberately simple so the icons stay legible
at 192px and when masked to a circle.

usage: python scripts/make_icons.py
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join("frontend", "public", "icons")
BG = (3, 10, 6)


def sphere_icon(size: int, pad_ratio: float = 0.16) -> Image.Image:
    ss = 4  # supersample
    w = size * ss
    img = Image.new("RGB", (w, w), BG)
    d = ImageDraw.Draw(img, "RGBA")
    cx = cy = w / 2
    r = (w / 2) * (1 - pad_ratio)

    # outer glow
    glow = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for i in range(14):
        rr = r * (1.02 + i * 0.05)
        a = int(26 * (1 - i / 14) ** 2)
        gd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(60, 255, 150, a))
    img = Image.alpha_composite(img.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(w * 0.02)))
    d = ImageDraw.Draw(img, "RGBA")

    # sphere body
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(6, 30, 18, 255))

    # wire mesh: meridians + parallels clipped by drawing inside the disc
    mesh = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    md = ImageDraw.Draw(mesh, "RGBA")
    lw = max(1, int(w * 0.006))
    for k in range(1, 5):
        rx = r * (k / 5)
        md.ellipse([cx - rx, cy - r, cx + rx, cy + r], outline=(80, 240, 150, 150), width=lw)
    for k in range(1, 5):
        y = cy - r + (2 * r) * (k / 5)
        half = math.sqrt(max(0.0, r * r - (y - cy) ** 2))
        md.line([cx - half, y, cx + half, y], fill=(80, 240, 150, 150), width=lw)
    md.line([cx, cy - r, cx, cy + r], fill=(150, 255, 200, 190), width=lw)

    # clip mesh to the sphere
    mask = Image.new("L", (w, w), 0)
    ImageDraw.Draw(mask).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    mesh.putalpha(Image.composite(mesh.getchannel("A"), Image.new("L", (w, w), 0), mask))
    img = Image.alpha_composite(img, mesh)
    d = ImageDraw.Draw(img, "RGBA")

    # limb + orbit ring
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(190, 255, 220, 220), width=max(2, int(w * 0.012)))
    ory = r * 0.42
    d.ellipse(
        [cx - r * 1.28, cy - ory, cx + r * 1.28, cy + ory],
        outline=(57, 255, 136, 130),
        width=max(1, int(w * 0.007)),
    )

    return img.convert("RGB").resize((size, size), Image.LANCZOS)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    sphere_icon(192).save(os.path.join(OUT, "icon-192.png"))
    sphere_icon(512).save(os.path.join(OUT, "icon-512.png"))
    # Maskable: more padding so the safe zone survives a circular mask.
    sphere_icon(512, pad_ratio=0.26).save(os.path.join(OUT, "maskable-512.png"))
    # Favicon
    sphere_icon(64).save(os.path.join(OUT, "favicon.png"))
    print("wrote icons to", OUT)


if __name__ == "__main__":
    main()
