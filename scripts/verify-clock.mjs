/**
 * Checks that the simulation runs on one clock, against the built app in headless
 * Chromium.
 *
 * The solver works non-dimensionally and has no idea how much time a step represents, so
 * the display decides how many steps a frame is worth. That arithmetic is unit-tested;
 * what is not, and cannot be, is whether the application actually uses it. This drives
 * the real frame loop and counts.
 *
 * It exists because of a specific defect. The clock was first asked from inside the
 * stepping loop's condition rather than before it, so every iteration spent a fresh
 * frame's worth of time, and the flow ran about sixty per cent fast at mid throttle. Unit
 * tests could not see it; the picture looked entirely reasonable. The last check below is
 * the one that caught it, and it catches it by a property rather than a number: the clock
 * clamps each frame to at most a twentieth of a second, so averaging over frames can only
 * ever lose time against that bound, never gain it. A measured rate above the bound means
 * the clock is being asked more than once a frame.
 *
 * Usage: npm run build && npm run preview, then node scripts/verify-clock.mjs
 */
import { chromium } from 'playwright';

const base = process.env.APP_URL ?? 'http://127.0.0.1:4173/wind_tunnel_simulator';
const aircraft = process.argv[2] ?? 'boeing737-800';
/** Coarse, and with the tracers off: this has to manage a usable frame rate on software GL. */
const resolution = Number(process.env.FLOW_RES ?? 48);
const WINDOW_SECONDS = Number(process.env.CLOCK_WINDOW ?? 25);
const SLOW_MOTION = 12;
const STEP_CELLS = 0.8;
const MAX_FRAME_SECONDS = 1 / 20;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server'],
});
const page = await browser.newPage({ viewport: { width: 360, height: 260 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });

await page.goto(`${base}/#${aircraft}`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, { timeout: 120000 });
await page.waitForFunction(
  () => !/Building/.test(document.getElementById('flow-status').textContent),
  { timeout: 120000 },
);

const supported = await page.evaluate(() => window.windTunnel.solver.supported);
if (!supported) {
  console.log('solver unsupported in this browser; nothing to verify');
  await browser.close();
  process.exit(0);
}

await page.evaluate((res) => {
  const tracers = document.getElementById('streamlines-enabled');
  if (tracers.checked) tracers.click();
  const wt = window.windTunnel;
  wt.solver.setResolution(res, wt.viewer.renderer.capabilities.maxTextureSize);
}, resolution);

// The flow runs flat out until it is established; nothing about the clock applies before.
const settleTarget = Math.round((2 * resolution) / STEP_CELLS);
let settled = 0;
for (let i = 0; i < 120; i++) {
  settled = await page.evaluate(() => window.windTunnel.solver.stats.steps);
  if (settled >= settleTarget) break;
  await new Promise((done) => setTimeout(done, 2000));
}

await page.evaluate(() => {
  window.__frames = 0;
  window.windTunnel.viewer.onFrame(() => { window.__frames++; });
});

const measure = (kmh, seconds) =>
  page.evaluate(async ([kmh, seconds]) => {
    window.windTunnel.store.set({ speedKmh: kmh });
    await new Promise((done) => setTimeout(done, 500));
    const fromSteps = window.windTunnel.solver.stats.steps;
    const fromFrames = window.__frames;
    const start = performance.now();
    await new Promise((done) => setTimeout(done, seconds * 1000));
    const domain = window.windTunnel.solver.domain;
    return {
      steps: window.windTunnel.solver.stats.steps - fromSteps,
      frames: window.__frames - fromFrames,
      elapsed: (performance.now() - start) / 1000,
      cell: (domain.max.x - domain.min.x) / window.windTunnel.solver.stats.grid.x,
    };
  }, [kmh, seconds]);

const rows = [];
for (const kmh of [200, 600, 1200]) {
  const m = await measure(kmh, WINDOW_SECONDS);
  const perFrame = m.frames > 0 ? m.steps / m.frames : 0;
  // The most the clock can ask for per frame: every frame clamped to the stall limit.
  const ceiling = ((kmh / 3.6) / SLOW_MOTION) * MAX_FRAME_SECONDS / (STEP_CELLS * m.cell);
  rows.push({ kmh, ...m, perFrame, ceiling, fps: m.frames / m.elapsed });
}

await browser.close();

const [slow, mid, fast] = rows;
const ratio = slow.perFrame > 0 ? fast.perFrame / slow.perFrame : 0;
const overSpent = rows.filter((r) => r.perFrame > r.ceiling * 1.02);

const checks = [
  ['the flow establishes itself', settled >= settleTarget,
    `reached ${settled} of ${settleTarget} steps; the clock does not apply before this`],
  ['the flow advances at all', rows.every((r) => r.steps > 0),
    rows.map((r) => `${r.kmh} km/h: ${r.steps} steps`).join(', ')],
  ['faster air sheds its wake faster', ratio > 4 && ratio < 8,
    `six times the airspeed gave ${ratio.toFixed(2)} times the step rate, expected near 6 - ` +
    `shedding follows a roughly constant Strouhal number, so it has to scale with speed`],
  ['it is in step with the middle of the range too', mid.perFrame > slow.perFrame && mid.perFrame < fast.perFrame,
    `${slow.perFrame.toFixed(3)}, ${mid.perFrame.toFixed(3)}, ${fast.perFrame.toFixed(3)} per frame`],
  ['the clock is asked once a frame', overSpent.length === 0,
    `${overSpent.map((r) => `${r.kmh} km/h ran ${r.perFrame.toFixed(3)}/frame against a ` +
      `ceiling of ${r.ceiling.toFixed(3)}`).join('; ')} - a rate above the ceiling means ` +
    `the frame's elapsed time was spent more than once`],
  ['no console errors', problems.length === 0, problems.join('; ')],
];

console.log(`${aircraft} at ${resolution} cells, ${WINDOW_SECONDS}s windows\n`);
let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log(`        ${detail}`); failed++; }
}
console.log();
for (const r of rows) {
  console.log(
    `  ${String(r.kmh).padStart(4)} km/h: ${r.perFrame.toFixed(3)} steps/frame ` +
    `(ceiling ${r.ceiling.toFixed(3)}) at ${r.fps.toFixed(1)} fps`,
  );
}
process.exit(failed === 0 ? 0 : 1);
