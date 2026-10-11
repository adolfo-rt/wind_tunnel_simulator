/**
 * Physical checks on the trailing wake, run against the built app in headless Chromium.
 *
 * The wake is the one part of the flow that is not solved on the grid. The lattice sheds
 * it from the circulation it solved, and a Biot-Savart pass evaluates it into the same
 * grid the solver uses, so that everything downstream still reads one velocity field.
 * These checks are about that field, and each is something a trailing wake must do:
 *
 *   - it is symmetric, because the aeroplane is and there is no sideslip;
 *   - it blows down between the tips and up outside them, which is the signature of
 *     lift and the sign the whole convention turns on;
 *   - it is what the circulation says it is, and nothing like as strong as the free
 *     stream;
 *   - it does not reach the air ahead of the aircraft;
 *   - and it does not disturb the balance the grid solver was verified on.
 *
 * Usage: npm run build && npm run preview, then node scripts/verify-wake.mjs
 */
import { chromium } from 'playwright';

const base = process.env.APP_URL ?? 'http://127.0.0.1:4173/wind_tunnel_simulator';
const aircraft = process.argv[2] ?? 'boeing737-800';
const resolution = Number(process.env.FLOW_RES ?? 64);
const steps = Number(process.env.FLOW_STEPS ?? 300);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 420 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });

await page.goto(`${base}/#${aircraft}`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, { timeout: 30000 });
await page.waitForFunction(
  () => !/Building/.test(document.getElementById('flow-status').textContent),
  { timeout: 90000 },
);

const supported = await page.evaluate(() => window.windTunnel.solver.supported);
if (!supported) {
  console.log('solver unsupported in this browser; nothing to verify');
  await browser.close();
  process.exit(0);
}

await page.evaluate((res) => {
  const wt = window.windTunnel;
  wt.viewer.stop();
  wt.solver.setResolution(res, wt.viewer.renderer.capabilities.maxTextureSize);
}, resolution);

let done = 0;
while (done < steps) {
  const chunk = Math.min(20, steps - done);
  await page.evaluate((n) => { for (let i = 0; i < n; i++) window.windTunnel.solver.step(); }, chunk);
  done += chunk;
}

const report = await page.evaluate(() => {
  const wt = window.windTunnel;
  const model = wt.panelModel();
  const domain = wt.solver.domain;
  const size = {
    x: domain.max.x - domain.min.x,
    y: domain.max.y - domain.min.y,
    z: domain.max.z - domain.min.z,
  };

  /*
   * The wake's own contribution, by difference.
   *
   * Reading the field with the filaments and again without them is the only way to get
   * at the induced velocity alone: the published field is the sum, deliberately, and
   * everything from the streamlines to the colour legend reads that sum. Taking the
   * difference measures exactly what was added, which is what these checks are about.
   */
  const combined = wt.solver.readVelocity();
  const count = wt.solver.wakeFilamentCount;
  wt.solver.setWake(null);
  const solvedOnly = wt.solver.readVelocity();
  wt.solver.setWake(model.wake);

  const { grid } = combined;
  const induced = new Float32Array(combined.data.length);
  for (let i = 0; i < induced.length; i++) induced[i] = combined.data[i] - solvedOnly.data[i];
  const rise = (x, y, z) => induced[(x + grid.x * (y + grid.y * z)) * 3 + 1];

  // Where the wake leaves the aircraft, in the tunnel's own coordinates.
  const m = wt.current().group.matrixWorld.elements;
  const leaves = model.wake.map((f) => ({
    x: m[0] * f.x + m[4] * f.y + m[8] * f.z + m[12],
    y: m[1] * f.x + m[5] * f.y + m[9] * f.z + m[13],
    z: m[2] * f.x + m[6] * f.y + m[10] * f.z + m[14],
  }));
  const span = Math.max(...leaves.map((p) => Math.abs(p.z)));
  const trailingEdge = Math.max(...leaves.map((p) => p.x));
  const height = leaves.reduce((sum, p) => sum + p.y, 0) / leaves.length;

  const cell = (world, min, extent, cells) =>
    Math.round(((world - min) / extent) * cells - 0.5);
  const cy = cell(height, domain.min.y, size.y, grid.y);
  const cx = Math.min(grid.x - 2, cell(trailingEdge + 0.1 * size.x, domain.min.x, size.x, grid.x));
  const atSpan = (fraction) => {
    const cz = cell(fraction * span, domain.min.z, size.z, grid.z);
    return cz > 0 && cz < grid.z - 1 ? rise(cx, cy, cz) : null;
  };

  // Symmetry, measured across the half-span rather than at one station.
  let worstAsymmetry = 0;
  for (let f = 0.1; f <= 1.21; f += 0.1) {
    const left = atSpan(-f);
    const right = atSpan(f);
    if (left === null || right === null) continue;
    worstAsymmetry = Math.max(worstAsymmetry, Math.abs(left - right));
  }

  let peak = 0;
  for (let i = 0; i < induced.length; i += 3) {
    peak = Math.max(peak, Math.hypot(induced[i], induced[i + 1], induced[i + 2]));
  }

  // Ahead of the aircraft, where a trailing wake has no business being.
  let ahead = 0;
  for (let x = 1; x < Math.floor(grid.x / 8); x++) {
    for (let y = 2; y < grid.y - 2; y++) {
      for (let z = 2; z < grid.z - 2; z++) {
        const i = (x + grid.x * (y + grid.y * z)) * 3;
        ahead = Math.max(ahead, Math.hypot(induced[i], induced[i + 1], induced[i + 2]));
      }
    }
  }

  let nonFinite = 0, sum = 0, n = 0;
  for (let i = 0; i < combined.data.length; i += 3) {
    const s = Math.hypot(combined.data[i], combined.data[i + 1], combined.data[i + 2]);
    if (!Number.isFinite(s)) nonFinite++; else { sum += s; n++; }
  }

  return {
    grid, count, CL: model.CL,
    span: +span.toFixed(2),
    insideWake: atSpan(0),
    atTip: atSpan(1),
    outsideTip: atSpan(1.2),
    worstAsymmetry, peak, ahead, nonFinite,
    domainMean: sum / n,
  };
});

await browser.close();

const r = report;
const checks = [
  ['the aircraft sheds a wake at all', r.count > 0 && r.peak > 1e-4,
    `${r.count} filaments, strongest induced velocity ${r.peak.toFixed(4)}`],
  ['it blows down between the tips', r.insideWake !== null && r.insideWake < -1e-3,
    `vertical velocity on the centreline behind the wing is ${Number(r.insideWake).toFixed(4)}, ` +
    `expected downwards for an aircraft at CL ${r.CL.toFixed(3)}`],
  ['it blows up outside them', r.outsideTip !== null && r.outsideTip > 0,
    `vertical velocity at 1.2 spans is ${Number(r.outsideTip).toFixed(4)}, expected upwards - ` +
    `the upwash outside the tips is the other half of the tip vortex`],
  ['the wake is symmetric', r.worstAsymmetry < 1e-3,
    `left and right differ by up to ${r.worstAsymmetry.toFixed(5)}; the aircraft is ` +
    `symmetric and is not sideslipping, so its wake has to be too`],
  ['it does not reach the air ahead', r.ahead < 5e-3,
    `induced velocity upstream reaches ${r.ahead.toFixed(4)}, expected below 0.005 - ` +
    `the filaments trail downstream and should barely be felt in front`],
  ['it stays a correction, not a flow of its own', r.peak < 0.25,
    `strongest induced velocity ${r.peak.toFixed(4)} against a free stream of 1; a wake ` +
    `this strong would mean the circulation or the core radius is wrong`],
  ['the field stays finite', r.nonFinite === 0, `${r.nonFinite} non-finite cells`],
  ['momentum is still not draining away', Math.abs(r.domainMean - 1) < 0.12,
    `domain mean speed ${r.domainMean.toFixed(3)} with the wake added, expected within 12% of 1`],
  ['no console errors', problems.length === 0, problems.join('; ')],
];

console.log(`${aircraft} at ${r.grid.x}x${r.grid.y}x${r.grid.z}, ${steps} steps, ${r.count} filaments\n`);
let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log(`        ${detail}`); failed++; }
}
console.log(
  `\n  downwash on the centreline ${Number(r.insideWake).toFixed(4)}, ` +
  `at the tip ${Number(r.atTip).toFixed(4)}, ` +
  `upwash at 1.2 spans ${Number(r.outsideTip).toFixed(4)}`,
);
process.exit(failed === 0 ? 0 : 1);
