/**
 * Physical checks on the streamline rake, run against the built app in headless Chromium.
 *
 * The rake draws continuous ribbons through the solved field, and the failure that
 * matters is the one that looks right: a streamline sailing straight through the
 * aeroplane. The field is exactly zero inside a solid, so a trace should stall at the
 * skin, but "should" is what these scripts exist to replace. Each check is something a
 * streamline must do:
 *
 *   - none of it is inside the aircraft;
 *   - every line starts at the inlet and most of them cross the whole tunnel;
 *   - they all sit in the plane they were asked for, because that is what a rake is;
 *   - they step finely enough that the curve is the field's and not the integrator's;
 *   - and moving the plane actually moves them.
 *
 * Usage: npm run build && npm run preview, then node scripts/verify-rake.mjs
 */
import { chromium } from 'playwright';

const base = process.env.APP_URL ?? 'http://127.0.0.1:4173/wind_tunnel_simulator';
const aircraft = process.argv[2] ?? 'boeing747-100';

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

// Settle the field, then switch the rake on and let its schedule run.
await page.evaluate(() => {
  const wt = window.windTunnel;
  wt.viewer.stop();
  const tracers = document.getElementById('streamlines-enabled');
  if (tracers.checked) tracers.click();
  for (let i = 0; i < 300; i++) wt.solver.step();
});
await page.evaluate(() => document.getElementById('rake-enabled').click());
await page.waitForFunction(() => window.windTunnel.rake.lineCount > 0, { timeout: 30000 });

const report = await page.evaluate(() => {
  const wt = window.windTunnel;
  const paths = wt.rake.paths();
  const domain = wt.solver.domain;
  const { grid } = wt.solver.stats;
  const cell = (domain.max.x - domain.min.x) / grid.x;
  const plane = wt.rake.planeWorld;

  let deepest = Infinity;
  let sampled = 0;
  let longestStep = 0;
  let nonFinite = 0;
  let offPlane = 0;
  let crossed = 0;
  let shortest = Infinity;
  let startedLate = 0;

  for (const path of paths) {
    if (path.length < 2) continue;
    const first = path[0];
    const last = path[path.length - 1];
    if (first[0] > domain.min.x + 0.12 * (domain.max.x - domain.min.x)) startedLate++;
    if (last[0] > domain.min.x + 0.75 * (domain.max.x - domain.min.x)) crossed++;
    shortest = Math.min(shortest, path.length);

    for (let i = 0; i < path.length; i++) {
      const [x, y, z] = path[i];
      if (![x, y, z].every(Number.isFinite)) { nonFinite++; continue; }
      offPlane = Math.max(offPlane, Math.abs(z - plane));
      if (i > 0) {
        const [px, py, pz] = path[i - 1];
        longestStep = Math.max(longestStep, Math.hypot(x - px, y - py, z - pz));
      }
      // The distance field is the aircraft's own, so this is the same test the tracers
      // are held to rather than a second opinion about where the aeroplane is.
      const d = wt.distanceToAircraft(x, y, z);
      if (d !== null) { deepest = Math.min(deepest, d); sampled++; }
    }
  }

  return {
    lines: paths.length, sampled, cell, plane,
    deepest, longestStep, nonFinite, offPlane, crossed, shortest, startedLate,
    span: domain.max.z - domain.min.z,
  };
});

// Moving the plane has to move the lines, or the slider is decoration.
const moved = await page.evaluate(async () => {
  const before = JSON.stringify(window.windTunnel.rake.paths()[0] ?? []);
  const slider = document.getElementById('rake-plane');
  slider.value = String(Math.round(Number(slider.max) * 0.78));
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((done) => setTimeout(done, 1200));
  return {
    changed: JSON.stringify(window.windTunnel.rake.paths()[0] ?? []) !== before,
    plane: window.windTunnel.rake.planeWorld,
  };
});

await browser.close();

const r = report;
const checks = [
  ['the rake draws lines at all', r.lines >= 12 && r.sampled > 500,
    `${r.lines} lines, ${r.sampled} points`],
  ['no streamline is inside the aircraft', r.deepest > -0.5 * r.cell,
    `deepest point ${r.deepest.toFixed(3)} m from the surface, expected no further ` +
    `inside than ${(-0.5 * r.cell).toFixed(3)} m - a line through the aeroplane is the ` +
    `most convincing wrong picture this can draw`],
  ['they start at the inlet', r.startedLate === 0,
    `${r.startedLate} of ${r.lines} lines began more than a tenth of the way down`],
  ['most of them cross the tunnel', r.crossed >= Math.ceil(r.lines * 0.5),
    `${r.crossed} of ${r.lines} reached three quarters of the way down; the rest run ` +
    `into the aircraft, which is the point of drawing them`],
  ['they stay in their own plane', r.offPlane < 0.08 * r.span,
    `a line wandered ${r.offPlane.toFixed(2)} m out of the plane across a ${r.span.toFixed(0)} m span`],
  ['steps stay short enough to follow the field', r.longestStep <= 0.75 * r.cell,
    `longest step ${r.longestStep.toFixed(3)} m against a ${r.cell.toFixed(3)} m cell`],
  ['every point is finite', r.nonFinite === 0, `${r.nonFinite} non-finite points`],
  ['moving the plane moves the lines', moved.changed,
    `the slider went to ${moved.plane.toFixed(1)} m and the first line did not change`],
  ['no console errors', problems.length === 0, problems.join('; ')],
];

console.log(`${aircraft}, ${r.lines} streamlines at z = ${r.plane.toFixed(1)} m, ${r.sampled} points\n`);
let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log(`        ${detail}`); failed++; }
}
process.exit(failed === 0 ? 0 : 1);
