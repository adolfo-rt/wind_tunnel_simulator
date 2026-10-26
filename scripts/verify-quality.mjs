/**
 * Checks on the quality tiers, run against the built app in headless Chromium.
 *
 * Two things are being established. First, that the control does something: each tier
 * down must actually shrink the solver grid, the obstacle field and the render scale,
 * or it is a button that costs a rebuild and buys nothing. Second, and the reason the
 * tiers needed a test at all, that none of it reaches the numbers the app reports.
 *
 * The third check is the one that cannot be unit tested: left alone on a machine that
 * cannot keep up - which headless software rendering certainly is - the frame meter has
 * to notice and step down by itself.
 *
 * Usage: npm run build && npm run preview, then node scripts/verify-quality.mjs
 */
import { chromium } from 'playwright';

const base = process.env.APP_URL ?? 'http://127.0.0.1:4173/wind_tunnel_simulator';
const aircraft = process.argv[2] ?? 'boeing787';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server'],
});

const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

/*
 * Clicks are dispatched directly rather than through Playwright's click.
 *
 * Software rendering keeps the main thread busy enough that the actionability wait -
 * "visible, enabled and stable" - never settles, and every click times out after thirty
 * seconds. The elements are checked for existence here instead; what is being verified
 * is what the handlers do, not whether Chromium can hit a button.
 */
async function press(target, selector) {
  const found = await target.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  if (!found) throw new Error(`no such control: ${selector}`);
}

const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));

await page.goto(`${base}/#${aircraft}`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, {
  timeout: 40000,
});

/** Cells, render scale and the reported lift-to-drag, as the interface has them. */
async function readState() {
  return page.evaluate(() => {
    const status = document.getElementById('flow-status')?.textContent ?? '';
    const cells = status.match(/\((\d+)k\)/);
    const grid = status.match(/(\d+)×(\d+)×(\d+)/);
    const scaleRow = [...document.querySelectorAll('#perf-readouts dt')].findIndex(
      (dt) => dt.textContent === 'Render scale',
    );
    const scale = [...document.querySelectorAll('#perf-readouts dd')][scaleRow]?.textContent;
    const pressed = [...document.querySelectorAll('#quality-tiers .axis')].find(
      (b) => b.getAttribute('aria-pressed') === 'true',
    );
    return {
      tier: pressed?.dataset.tier ?? null,
      cells: cells ? Number(cells[1]) : null,
      grid: grid ? grid[0] : null,
      scale: scale ? Number(scale.replace('×', '')) : null,
    };
  });
}

/** The cruise figures as the sheet shows them, which is what a reader would compare. */
async function readFigures() {
  await press(page, '#analysis-open');
  await page.waitForSelector('#analysis', { state: 'visible' });
  const values = await page.evaluate(() =>
    [...document.querySelectorAll('.stat-tile .stat-value')].map((v) => v.textContent),
  );
  await press(page, '#analysis-close');
  return values;
}

// ---- Each tier, chosen by hand -----------------------------------------------
const seen = {};
for (const tier of ['high', 'balanced', 'low']) {
  await press(page, `#quality-tiers .axis[data-tier="${tier}"]`);
  // A tier that changes the mesh or the obstacle field reloads the aircraft.
  await page.waitForTimeout(500);
  await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, {
    timeout: 40000,
  });
  /*
   * Wait for the status line to actually carry a grid again, rather than for a fixed
   * delay. It repaints four times a second measured in frames, so on a machine rendering
   * at one frame a second "four times a second" is once every few seconds - and a fixed
   * 900ms wait read the line while it still said "Building the obstacle field…".
   */
  await page.waitForFunction(
    () => /\d+×\d+×\d+/.test(document.getElementById('flow-status')?.textContent ?? ''),
    { timeout: 60000 },
  );
  const state = await readState();
  const figures = await readFigures();
  seen[tier] = { ...state, figures };
  check(`${tier} applies`, state.tier === tier, `${state.grid} cells, render scale ${state.scale}×`);
}

// ---- The control does something ----------------------------------------------
check(
  'the grid shrinks going down the tiers',
  seen.high.cells > seen.balanced.cells && seen.balanced.cells > seen.low.cells,
  `${seen.high.cells}k → ${seen.balanced.cells}k → ${seen.low.cells}k`,
);
check(
  'the render scale never rises going down',
  seen.high.scale >= seen.balanced.scale && seen.balanced.scale >= seen.low.scale,
  `${seen.high.scale}× → ${seen.balanced.scale}× → ${seen.low.scale}×`,
);

// ---- And none of it reaches the numbers --------------------------------------
const same =
  JSON.stringify(seen.high.figures) === JSON.stringify(seen.balanced.figures) &&
  JSON.stringify(seen.balanced.figures) === JSON.stringify(seen.low.figures);
check(
  'the reported cruise figures are identical at every tier',
  same,
  same ? seen.high.figures.join(' · ') : `high ${seen.high.figures} vs low ${seen.low.figures}`,
);

// ---- Left alone, it notices a machine that cannot keep up ---------------------
/*
 * A fresh page, nothing clicked. Headless software rendering cannot hold the top tier,
 * so the meter has to demote without being asked. If this ever passes trivially because
 * the renderer got fast, the note text is checked too - it says why it dropped.
 */
/*
 * The first page is closed before this one opens. Two tabs both rendering a wind tunnel
 * in software share one CPU, and the second was being starved badly enough that merely
 * loading it timed out - which would have been reported as "the meter did not demote".
 */
await page.close();
const auto = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await auto.goto(`${base}/#${aircraft}`, { waitUntil: 'load', timeout: 60000 });
await auto.waitForFunction(() => document.getElementById('loading')?.hidden === true, {
  timeout: 40000,
});
/*
 * Generous, and polled on a timer rather than on animation frames.
 *
 * Both because of what is being tested: a renderer slow enough to need demoting is slow
 * enough that the meter takes most of a minute to gather its evidence, and slow enough
 * that requestAnimationFrame - Playwright's default polling - fires about once every
 * five seconds. Measured here, demotion lands around forty-five seconds after load.
 */
const waitStart = Date.now();
const demoted = await auto
  .waitForFunction(
    () =>
      document.querySelector('#quality-tiers .axis[aria-pressed="true"]')?.dataset.tier !== 'high',
    { timeout: 180000, polling: 1000 },
  )
  .then(() => true)
  .catch((error) => {
    // Reported rather than swallowed: a wait that fails for its own reasons is not
    // evidence that the meter did nothing, and silently treating it as such sent this
    // check chasing the wrong bug twice.
    console.log(`      (wait ended early: ${error.message.split('\n')[0]})`);
    return false;
  });
const note = await auto.textContent('#quality-note');
const perfAtFailure = await auto.evaluate(() =>
  [...document.querySelectorAll('#perf-readouts dd')].map((d) => d.textContent).join(' / '),
);
const landedOn = await auto.evaluate(
  () => document.querySelector('#quality-tiers .axis[aria-pressed="true"]')?.dataset.tier,
);
check(
  'it steps down on a machine that cannot keep up',
  demoted,
  demoted
    ? `dropped to ${landedOn} after ${((Date.now() - waitStart) / 1000).toFixed(0)}s`
    : `still on high after ${((Date.now() - waitStart) / 1000).toFixed(0)}s; meter reports ${perfAtFailure}`,
);
check(
  'and says why',
  !demoted || /fps/.test(note ?? ''),
  note?.slice(0, 90),
);

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nAll quality checks passed.');
