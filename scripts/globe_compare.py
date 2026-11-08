"""Numeric comparison of the rendered globe vs the reference artwork.

Measures, for each image:
  * the sphere disc: centre, radius (fraction of frame height)
  * interior brightness (mean green channel over the disc)
  * limb peak brightness in a 3px annulus just inside r
  * the surrounding field brightness at several radii
  * background brightness in the four corners (edge vignette)

Usage: python globe_compare.py <ref.png> <crop-box> <render.png>
"""
import sys
from PIL import Image
import numpy as np

# Reference globe is in docs/reference/ui-reference.png at this crop
REF_CROP = (790, 60, 1210, 520)     # (l, t, r, b)  -> 420x460


def load(path, crop=None):
    im = Image.open(path).convert("RGB")
    if crop:
        im = im.crop(crop)
    a = np.asarray(im).astype(np.float32)
    return a


def disc(a):
    g = a[..., 1]
    h, w = g.shape
    # bright pixels = sphere filaments
    thr = g > 90
    ys, xs = np.nonzero(thr)
    if len(xs) < 50:
        thr = g > np.percentile(g, 99)
        ys, xs = np.nonzero(thr)
    cx = xs.mean()
    cy = ys.mean()
    r = np.sqrt(len(xs) / np.pi)
    return cx, cy, r


def stats(a, cx, cy, r):
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / max(r, 1e-6)
    g = a[..., 1]
    out = {}
    out["interior_mean"] = float(g[d < 0.80].mean())
    out["interior_p90"] = float(np.percentile(g[d < 0.80], 90))
    out["limb_peak"] = float(np.percentile(g[(d > 0.88) & (d < 0.99)], 99))
    out["just_outside"] = float(g[(d > 1.02) & (d < 1.10)].mean())
    for rr in (1.3, 1.8, 2.5):
        m = (d > rr - 0.08) & (d < rr + 0.08)
        out[f"field_{rr}r"] = float(g[m].mean()) if m.any() else float("nan")
    out["corners"] = float(np.mean([g[:20, :20].mean(), g[:20, -20:].mean(),
                                    g[-20:, :20].mean(), g[-20:, -20:].mean()]))
    out["frame_mean"] = float(g.mean())
    out["centre"] = (round(float(cx)), round(float(cy)))
    out["radius"] = round(float(r), 1)
    out["r_frac_h"] = round(float(r / h), 4)
    return out


def main():
    ref_path, crop, render_path = sys.argv[1], sys.argv[2], sys.argv[3]
    crop = tuple(int(v) for v in crop.split(",")) if crop != "none" else None
    for name, path, c in (("REFERENCE", ref_path, crop), ("RENDER", render_path, None)):
        a = load(path, c)
        cx, cy, r = disc(a)
        s = stats(a, cx, cy, r)
        print(f"--- {name} ({path}) frame={a.shape[1]}x{a.shape[0]}")
        for k, v in s.items():
            print(f"    {k:16s} {v}")


if __name__ == "__main__":
    main()
