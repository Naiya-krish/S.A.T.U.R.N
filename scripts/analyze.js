/** Quick pixel statistics for a PNG (used to check palette fidelity). */
const { PNG } = require('pngjs');
const fs = require('fs');
const p = PNG.sync.read(fs.readFileSync(process.argv[2]));
const regions = process.argv.slice(3);
let cols = [0, 0, 0];
let mx = [0, 0, 0];
const hist = {};
for (let i = 0; i < p.data.length; i += 4) {
  for (let c = 0; c < 3; c++) {
    const v = p.data[i + c];
    cols[c] += v;
    if (v > mx[c]) mx[c] = v;
  }
  const key = [p.data[i], p.data[i + 1], p.data[i + 2]].join(',');
  hist[key] = (hist[key] || 0) + 1;
}
const n = p.width * p.height;
console.log('size', p.width, p.height, 'avg', cols.map((c) => Math.round(c / n)), 'max', mx);
console.log('top colours', Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 5));
for (const r of regions) {
  const [x, y] = r.split(',').map(Number);
  const i = (p.width * y + x) * 4;
  console.log(`px(${x},${y})`, [p.data[i], p.data[i + 1], p.data[i + 2]]);
}
