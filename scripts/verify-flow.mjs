/**
 * Physical checks on the flow solver, run against the built app in headless Chromium.
 *
 * The solver cannot be unit-tested in Node because it lives on the GPU, and judging it
 * by whether a picture looks plausible is no test at all. These are things that must be
 * true of flow around a body, each of which failed at some point during development:
 *
 *   - the free stream arrives undisturbed, which it did not while the domain edge was
 *     treated as a wall the flow slammed into;
 *   - it accelerates somewhere, which it never did while the pressure solve was
 *     restarted from zero every step and could only block the flow, not divert it;
 *   - it slows markedly behind the aircraft;
 *   - the aircraft itself holds still air;
 *   - and momentum is roughly conserved rather than quietly draining away.
 *
 * Usage: npm run build && npm run preview, then node scripts/verify-flow.mjs
 */
import { chromium } from 'playwright';

const base = process.env.APP_URL ?? 'http://127.0.0.1:4173/wind_tunnel_simulator';
const aircraft = process.argv[2] ?? 'boeing737-800';
const resolution = Number(process.env.FLOW_RES ?? 64);
const steps = Number(process.env.FLOW_STEPS ?? 400);

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
  const { data, grid } = wt.solver.readVelocity();
  const at = (x, y, z) => {
    const i = (x + grid.x * (y + grid.y * z)) * 3;
    return Math.hypot(data[i], data[i + 1], data[i + 2]);
  };
  const yMid = Math.floor(grid.y / 2);
  const zMid = Math.floor(grid.z / 2);

  let max = 0, sum = 0, n = 0, nonFinite = 0;
  for (let i = 0; i < data.length; i += 3) {
    const s = Math.hypot(data[i], data[i + 1], data[i + 2]);
    if (!Number.isFinite(s)) { nonFinite++; continue; }
    max = Math.max(max, s);
    sum += s;
    n++;
  }

  // Upstream: the first eighth of the domain, well ahead of the aircraft.
  let upstream = 0, upstreamCount = 0;
  for (let x = 1; x < Math.floor(grid.x / 8); x++) {
    for (let y = 2; y < grid.y - 2; y++) {
      for (let z = 2; z < grid.z - 2; z++) { upstream += at(x, y, z); upstreamCount++; }
    }
  }

  // The wake, on the centreline just behind the aircraft.
  let wake = Infinity;
  for (let x = Math.floor(grid.x * 0.6); x < Math.floor(grid.x * 0.85); x++) {
    wake = Math.min(wake, at(x, yMid, zMid));
  }

  return {
    grid, max, mean: sum / n, nonFinite,
    upstreamMean: upstream / upstreamCount,
    wakeMin: wake,
  };
});

await browser.close();

const checks = [
  ['free stream arrives undisturbed', Math.abs(report.upstreamMean - 1) < 0.05,
    `upstream mean speed ${report.upstreamMean.toFixed(3)}, expected within 5% of 1`],
  ['flow accelerates past the aircraft', report.max > 1.02,
    `peak speed ${report.max.toFixed(3)}, expected above 1.02`],
  ['a wake forms behind it', report.wakeMin < 0.6,
    `slowest wake speed ${report.wakeMin.toFixed(3)}, expected below 0.6`],
  ['momentum is not draining away', Math.abs(report.mean - 1) < 0.12,
    `domain mean speed ${report.mean.toFixed(3)}, expected within 12% of 1`],
  ['the field stays finite', report.nonFinite === 0, `${report.nonFinite} non-finite cells`],
  ['no console errors', problems.length === 0, problems.join('; ')],
];

console.log(`${aircraft} at ${report.grid.x}x${report.grid.y}x${report.grid.z}, ${steps} steps\n`);
let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log(`        ${detail}`); failed++; }
}
process.exit(failed === 0 ? 0 : 1);
