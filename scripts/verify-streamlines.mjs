/**
 * Checks on the streamlines, run against the built app in headless Chromium.
 *
 * Particles are the easiest thing in the project to fake convincingly: almost any
 * animation of dots drifting past an aeroplane looks like airflow. So none of these
 * checks look at the picture. They read the particle positions back off the GPU and ask
 * whether the things that must be true of tracers in a wind tunnel are true.
 *
 * The central one compares how far each particle actually travelled with the speed of
 * the field where it started. Those two numbers have no common cause in the code — one
 * is the outcome of an integration on the GPU, the other a readback of the solver's own
 * grid — so their agreeing is evidence that the streamlines are drawn from the flow
 * rather than from something that merely looks like it. Comparing against the field
 * rather than against the free stream also keeps this test about the streamlines: how
 * well the solver has converged is stage 3's business, and `npm run verify:flow` is where
 * that gets asked.
 *
 * Usage: npm run build && npm run preview, then node scripts/verify-streamlines.mjs
 */
import { chromium } from 'playwright';

const base = process.env.APP_URL ?? 'http://127.0.0.1:4173/wind_tunnel_simulator';
const aircraft = process.argv[2] ?? 'boeing737-800';
const resolution = Number(process.env.FLOW_RES ?? 48);
const solverSteps = Number(process.env.FLOW_STEPS ?? 200);
const frames = 30;

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

// Take the render loop out of it, drop the grid to something software rendering can
// manage, and let the flow settle before any particle is asked to follow it.
await page.evaluate((res) => {
  const wt = window.windTunnel;
  wt.viewer.stop();
  wt.solver.setResolution(res, wt.viewer.renderer.capabilities.maxTextureSize);
  wt.streamlines.setCount(1024, wt.tunnel.size.radius);
}, resolution);

let done = 0;
while (done < solverSteps) {
  const chunk = Math.min(20, solverSteps - done);
  await page.evaluate((n) => { for (let i = 0; i < n; i++) window.windTunnel.solver.step(); }, chunk);
  done += chunk;
}

/**
 * Release the particles at each tunnel setting and see where they get to.
 *
 * All of it in one pass through the page, with the velocity field read back before any
 * particle is stepped. `readVelocity` is a debugging readback that the app itself never
 * performs, and interleaving it with the particle passes perturbs them - the tracers came
 * out moving at a flat free-stream speed instead of following the field. Reading the
 * field once, first, keeps the measurement out of the way of the thing being measured.
 *
 * Travel is summarised by the median, over particles that moved downstream: one that
 * reached the outlet during the run restarts at the inlet, and its displacement is then
 * minus the length of the working section.
 */
const results = await page.evaluate(
  ({ speeds, frames }) => {
    const wt = window.windTunnel;
    const dt = 1 / 60;
    const seconds = frames * dt;

    const { data, grid } = wt.solver.readVelocity();
    const domain = wt.solver.domain;
    const size = {
      x: domain.max.x - domain.min.x,
      y: domain.max.y - domain.min.y,
      z: domain.max.z - domain.min.z,
    };
    const cellOf = (v, min, extent, cells) =>
      Math.min(cells - 1, Math.max(0, Math.floor(((v - min) / extent) * cells)));
    const fieldSpeed = (x, y, z) => {
      const i =
        (cellOf(x, domain.min.x, size.x, grid.x) +
          grid.x * (cellOf(y, domain.min.y, size.y, grid.y) +
            grid.y * cellOf(z, domain.min.z, size.z, grid.z))) * 3;
      return Math.hypot(data[i], data[i + 1], data[i + 2]);
    };
    const median = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    };

    const cell = size.x / grid.x;
    const slack = cell * 0.01;

    return speeds.map((speedKmh) => {
      wt.store.set({ speedKmh });
      wt.streamlines.setVelocity(wt.solver.velocityTexture);
      wt.streamlines.reset();

      const before = wt.streamlines.readPositions();
      for (let i = 0; i < frames; i++) wt.streamlines.step(dt);
      const after = wt.streamlines.readPositions();

      const travel = [];
      const field = [];
      const bins = new Array(8).fill(0);
      let nonFinite = 0;
      let outside = 0;
      let deepest = Infinity;

      for (let i = 0; i < before.length; i += 3) {
        const x = after[i], y = after[i + 1], z = after[i + 2];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          nonFinite++;
          continue;
        }

        const dx = x - before[i];
        if (dx > 0) travel.push(dx);
        field.push(fieldSpeed(before[i], before[i + 1], before[i + 2]));

        if (
          x < domain.min.x - slack || x > domain.max.x + slack ||
          y < domain.min.y - slack || y > domain.max.y + slack ||
          z < domain.min.z - slack || z > domain.max.z + slack
        ) outside++;

        const distance = wt.distanceToAircraft(x, y, z);
        if (distance !== null) deepest = Math.min(deepest, distance);

        bins[Math.min(7, Math.floor(((x - domain.min.x) / size.x) * 8))]++;
      }

      return {
        speedKmh,
        count: before.length / 3,
        cell,
        // Metres a particle in undisturbed flow should have covered.
        expected: (speedKmh / 3.6 / wt.slowMotion) * seconds,
        travelled: median(travel),
        fieldSpeed: median(field),
        stepping: wt.streamlines.stepping,
        nonFinite,
        outside,
        deepest,
        bins,
      };
    });
  },
  { speeds: [400, 800], frames },
);

const [slow, fast] = results;
await browser.close();

/** How fast the particles actually went, as a fraction of the free stream. */
const measured = (r) => r.travelled / r.expected;
const ratio = measured(slow) === 0 ? 0 : measured(fast) / measured(slow);
const agrees = (r) => Math.abs(measured(r) - r.fieldSpeed) < 0.05;

const checks = [
  ['particles move at the speed of the field they are in',
    agrees(slow) && agrees(fast),
    `at 400 km/h they covered ${measured(slow).toFixed(3)} of the free stream where the ` +
    `field says ${slow.fieldSpeed.toFixed(3)}; at 800 km/h ${measured(fast).toFixed(3)} ` +
    `against ${fast.fieldSpeed.toFixed(3)}`],
  ['travel scales with the tunnel speed', Math.abs(ratio - 1) < 0.05,
    `doubling the speed changed travel by ${(ratio * 2).toFixed(2)}x, expected 2x`],
  ['no particle is inside the aircraft', fast.deepest > -0.25 * fast.cell,
    `deepest particle ${fast.deepest.toFixed(3)} m from the surface, expected no further ` +
    `inside than ${(-0.25 * fast.cell).toFixed(3)} m`],
  ['particles stay in the working section', fast.outside === 0,
    `${fast.outside} of ${fast.count} outside the domain`],
  ['they are spread along the tunnel', fast.bins.every((n) => n > 0),
    `lengthwise bins: ${fast.bins.join(', ')}`],
  ['steps stay short enough to follow the field', fast.stepping.cellsPerStep <= 0.36,
    `${fast.stepping.cellsPerStep.toFixed(3)} cells per step over ` +
    `${fast.stepping.substeps} substeps, expected at most 0.35`],
  ['trail samples stay close enough to draw a line through',
    fast.stepping.chordCells <= 0.61,
    `${fast.stepping.chordCells.toFixed(3)} cells between samples over ` +
    `${fast.stepping.records} recordings a frame, expected at most 0.6`],
  ['positions stay finite', fast.nonFinite === 0, `${fast.nonFinite} non-finite positions`],
  ['no console errors', problems.length === 0, problems.join('; ')],
];

console.log(`${aircraft}, ${fast.count} tracers on a ${fast.cell.toFixed(2)} m grid\n`);
let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log(`        ${detail}`); failed++; }
}
process.exit(failed === 0 ? 0 : 1);
