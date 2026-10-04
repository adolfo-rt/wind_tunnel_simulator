/**
 * Checks on the surface pressure, run against the built app in headless Chromium.
 *
 * The values tested are the ones the picture is drawn from: the panel model writes Cp onto
 * the aircraft's own vertices, and this reads that attribute back. Nothing here looks at
 * a pixel, and nothing recomputes the pressure a second way to compare against itself.
 *
 * Usage: npm run build && npm run preview, then node scripts/verify-pressure.mjs
 */
import { chromium } from 'playwright';

const base = process.env.APP_URL ?? 'http://127.0.0.1:4173/wind_tunnel_simulator';
const aircraft = process.argv[2] ?? 'boeing737-800';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 420 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });

await page.goto(`${base}/#${aircraft}`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, { timeout: 60000 });
await page.evaluate(() => {
  window.windTunnel.viewer.stop();
  document.getElementById('pressure-enabled').click();
});

const report = await page.evaluate(() => {
  const wt = window.windTunnel;
  const model = wt.panelModel();
  const parts = wt.surfacePressures();

  const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const wing = model.surfaces.find((s) => s.name === 'wing');
  const upper = wing.sections.flatMap((s) => [...s.upper]);
  const lower = wing.sections.flatMap((s) => [...s.lower]);

  const fuselage = parts.find((p) => p.aero === 'fuselage');
  let highest = -Infinity;
  let nonFinite = 0;
  let aboveStagnation = 0;
  let untaggedNonZero = 0;
  for (const part of parts) {
    for (const cp of part.cp) {
      if (!Number.isFinite(cp)) { nonFinite++; continue; }
      highest = Math.max(highest, cp);
      if (cp > 1 + 1e-6) aboveStagnation++;
      if (part.aero === 'untagged' && cp !== 0) untaggedNonZero++;
    }
  }

  // Cp is a coefficient: the division by dynamic pressure takes the speed out, so the
  // surface must read identically at every setting of the slider.
  const snapshot = () => wt.surfacePressures().map((p) => Array.from(p.cp));
  wt.store.set({ speedKmh: 400 });
  const slow = snapshot();
  wt.store.set({ speedKmh: 1300 });
  const fast = snapshot();
  let drift = 0;
  for (let i = 0; i < slow.length; i++) {
    for (let j = 0; j < slow[i].length; j++) {
      drift = Math.max(drift, Math.abs(slow[i][j] - fast[i][j]));
    }
  }

  return {
    CL: model.CL,
    upperMean: mean(upper),
    lowerMean: mean(lower),
    upperPeak: Math.min(...upper),
    fuselageMax: Math.max(...fuselage.cp),
    highest, nonFinite, aboveStagnation, untaggedNonZero, drift,
    parts: parts.length,
  };
});

await browser.close();

const checks = [
  ['the nose brings the flow to rest', Math.abs(report.fuselageMax - 1) < 0.01,
    `highest Cp on the fuselage is ${report.fuselageMax.toFixed(4)}, expected 1`],
  ['nothing exceeds stagnation', report.aboveStagnation === 0,
    `${report.aboveStagnation} vertices above Cp = 1, which incompressible flow cannot reach`],
  ['the wing sucks harder on top than underneath', report.upperMean < report.lowerMean,
    `mean Cp ${report.upperMean.toFixed(4)} above against ${report.lowerMean.toFixed(4)} below`],
  ['that difference is what lifts it', report.CL > 0.03,
    `lift coefficient ${report.CL.toFixed(4)}`],
  /*
   * Tied to the lift rather than to a number, because the roster contains a slender
   * delta. Concorde at a 2.5 degree cruise attitude makes a lift coefficient of 0.066
   * and a suction peak of -0.23, and both are correct: a delta that slender needs a far
   * larger angle to do the same work, which is why it flew and landed nose-high. A fixed
   * threshold tuned on a 737 calls that a failure. Requiring the peak to be commensurate
   * with the lift is the statement actually worth making.
   */
  ['the suction peak is commensurate with the lift', report.upperPeak < -0.4 * report.CL,
    `lowest Cp on the upper surface is ${report.upperPeak.toFixed(4)} at CL ${report.CL.toFixed(4)}`],
  ['the aircraft is lifted by its wing, not its fuselage',
    report.lowerMean - report.upperMean > 0.2 * report.CL,
    `mean Cp difference across the wing is ${(report.lowerMean - report.upperMean).toFixed(4)}`],
  ['Cp does not change with the tunnel speed', report.drift === 0,
    `largest change between 400 and 1300 km/h was ${report.drift}`],
  ['surfaces the model has never seen claim nothing', report.untaggedNonZero === 0,
    `${report.untaggedNonZero} vertices on untagged parts carry a non-zero Cp`],
  ['every value is finite', report.nonFinite === 0, `${report.nonFinite} non-finite values`],
  ['no console errors', problems.length === 0, problems.join('; ')],
];

console.log(`${aircraft}, ${report.parts} parts\n`);
let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log(`        ${detail}`); failed++; }
}
process.exit(failed === 0 ? 0 : 1);
