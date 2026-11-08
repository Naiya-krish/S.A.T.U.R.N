/**
 * Builds docs/reference/compare.png: reference | build | difference.
 * usage: node compare.js [buildPng] [outPng]
 */
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');
const pixelmatchMod = require('pixelmatch');
const pixelmatch = pixelmatchMod.default || pixelmatchMod;

const refPath = path.join(__dirname, '..', 'docs', 'reference', 'ui-reference.png');
const buildPath = process.argv[2] || path.join(__dirname, '..', 'docs', 'reference', 'saturn-1456.png');
const outPath = process.argv[3] || path.join(__dirname, '..', 'docs', 'reference', 'compare.png');

if (!fs.existsSync(refPath)) {
  console.error(`Reference image missing: ${refPath}`);
  process.exit(2);
}

const ref = PNG.sync.read(fs.readFileSync(refPath));
const build = PNG.sync.read(fs.readFileSync(buildPath));
const W = Math.max(ref.width, build.width);
const H = Math.max(ref.height, build.height);

const pad = (img) => {
  if (img.width === W && img.height === H) return img;
  const out = new PNG({ width: W, height: H });
  PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0);
  return out;
};
const a = pad(ref);
const b = pad(build);
const diff = new PNG({ width: W, height: H });
const changed = pixelmatch(a.data, b.data, diff.data, W, H, { threshold: 0.14, includeAA: false });

const gap = 12;
const out = new PNG({ width: W * 3 + gap * 2, height: H });
const fill = (img, ox) => PNG.bitblt(img, out, 0, 0, W, H, ox, 0);
fill(a, 0);
fill(b, W + gap);
fill(diff, W * 2 + gap * 2);
fs.writeFileSync(outPath, PNG.sync.write(out));
const pct = ((changed / (W * H)) * 100).toFixed(2);
console.log(`compare.png written (${out.width}x${out.height}); differing pixels: ${changed} (${pct}%)`);
