/**
 * Measures the globe disc in a screenshot: bounding box of pixels whose green
 * channel exceeds a threshold inside the centre region, plus the centre colour.
 * usage: node measure-globe.js <img.png> [...more]
 */
const PNG = require('pngjs').PNG;
const fs = require('fs');
const path = require('path');

for (const f of process.argv.slice(2)) {
  const img = PNG.sync.read(fs.readFileSync(path.resolve(f)));
  let minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
  for (let y = 60; y < 600; y += 2) {
    for (let x = 300; x < 1100; x += 2) {
      const i = (img.width * y + x) << 2;
      if (img.data[i + 1] >= 45) {
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
      }
    }
  }
  const cx = Math.round((minx + maxx) / 2);
  const cy = Math.round((miny + maxy) / 2);
  const c = (img.width * cy + cx) << 2;
  const samples = [];
  for (const dx of [-120, -60, 0, 60, 120]) {
    const i = (img.width * cy + (cx + dx)) << 2;
    samples.push(`${dx}:${img.data[i + 1]}`);
  }
  console.log(
    path.basename(f),
    `bbox x=${minx}..${maxx} y=${miny}..${maxy}`,
    `centre=(${cx},${cy}) r=${((maxx - minx) / 2).toFixed(0)}`,
    `centreRGB=(${img.data[c]},${img.data[c + 1]},${img.data[c + 2]})`,
    `G-across=${samples.join(' ')}`,
  );
}
