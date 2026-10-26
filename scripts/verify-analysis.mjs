/**
 * Checks on the cruise analysis sheet, run against the built app in headless Chromium.
 *
 * A chart is the one part of this project that can be completely wrong and still look
 * finished, so these are measurements rather than a screenshot: the sheet opens, the
 * marks are where the data says they should be, the axes bracket the values, nothing
 * overflows its box, and every figure carries the label saying where it came from.
 *
 * Usage: npm run build && npm run preview, then node scripts/verify-analysis.mjs
 */
import { chromium } from 'playwright';

const base = process.env.APP_URL ?? 'http://127.0.0.1:4173/wind_tunnel_simulator';
const aircraft = process.argv[2] ?? 'boeing787';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });

const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

page.on('pageerror', (error) => failures.push(`page error: ${error.message}`));

await page.goto(`${base}/#${aircraft}`, { waitUntil: 'networkidle' });
await page.waitForSelector('#analysis-open', { state: 'visible' });

// ---- It opens, and it closes ------------------------------------------------
await page.click('#analysis-open');
await page.waitForSelector('#analysis', { state: 'visible' });
check('the sheet opens', await page.isVisible('#analysis'));
check(
  'the opener reports its state',
  (await page.getAttribute('#analysis-open', 'aria-expanded')) === 'true',
);

// ---- The sheet fits the viewport -------------------------------------------
const box = await page.locator('#analysis').boundingBox();
const viewport = page.viewportSize();
check(
  'the sheet fits on screen',
  box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 &&
    box.y + box.height <= viewport.height + 1,
  `${Math.round(box.width)}×${Math.round(box.height)} at (${Math.round(box.x)}, ${Math.round(box.y)})`,
);

// ---- Nothing overflows its container ---------------------------------------
const overflow = await page.evaluate(() => {
  const scroll = document.querySelector('.analysis-scroll');
  const bad = [];
  for (const node of scroll.querySelectorAll('.stat-tile, .drag-bar, .analysis-table, .chart-wrap')) {
    const r = node.getBoundingClientRect();
    const s = scroll.getBoundingClientRect();
    if (r.right > s.right + 1 || r.left < s.left - 1) {
      bad.push(`${node.className}: ${Math.round(r.left)}..${Math.round(r.right)} vs ${Math.round(s.left)}..${Math.round(s.right)}`);
    }
  }
  return bad;
});
check('nothing overflows the sheet horizontally', overflow.length === 0, overflow.join('; '));

// ---- The chart's marks agree with the data ---------------------------------
const chart = await page.evaluate(() => {
  const svg = document.querySelector('.fuel-chart');
  if (!svg) return null;
  const dots = [...svg.querySelectorAll('circle')].map((c) => ({
    cx: Number(c.getAttribute('cx')),
    cy: Number(c.getAttribute('cy')),
    r: Number(c.getAttribute('r')),
    fill: c.getAttribute('fill'),
    title: c.querySelector('title')?.textContent ?? '',
  }));
  const box = svg.viewBox.baseVal;
  return { dots, width: box.width, height: box.height };
});
check('the chart rendered', chart !== null && chart.dots.length > 0, `${chart?.dots.length} marks`);

// Every mark carries the value it is drawn from, so the chart can be checked against
// the numbers rather than against a picture of them.
const parsed = chart.dots
  .map((d) => {
    const match = d.title.match(/\((\d{4})\):\s*([\d.]+) kg/);
    return match ? { ...d, year: Number(match[1]), fuel: Number(match[2]) } : null;
  })
  .filter(Boolean);
check('every mark is labelled with its data', parsed.length === chart.dots.length);

// Marks inside the plot area.
const inside = parsed.every(
  (d) => d.cx > 0 && d.cx < chart.width && d.cy > 0 && d.cy < chart.height,
);
check('every mark is inside the plot', inside);

// The y axis must run the right way: more fuel is higher on the page, which means a
// SMALLER cy. This is the check that catches an inverted axis, which looks plausible.
const sorted = [...parsed].sort((a, b) => a.fuel - b.fuel);
const monotonic = sorted.every((d, i) => i === 0 || d.cy <= sorted[i - 1].cy + 0.5);
check('more fuel plots higher', monotonic);

// And the x axis: a later aircraft is further right.
const byYear = [...parsed].sort((a, b) => a.year - b.year);
const rightwards = byYear.every((d, i) => i === 0 || d.cx >= byYear[i - 1].cx - 0.5);
check('a later aircraft plots further right', rightwards);

// Exactly one mark is emphasised, and it is the aircraft in the tunnel.
const emphasised = parsed.filter((d) => d.fill === '#4da3ff');
check('exactly one mark is emphasised', emphasised.length === 1, `${emphasised.length} highlighted`);

// ---- Axis labels bracket the data ------------------------------------------
const axis = await page.evaluate(() =>
  [...document.querySelectorAll('.fuel-chart .chart-axis-label')].map((t) => t.textContent),
);
const fuels = parsed.map((d) => d.fuel);
const topTick = Math.max(...axis.map(Number).filter((n) => Number.isFinite(n) && n < 100));
check(
  'the value axis contains the data',
  topTick >= Math.max(...fuels),
  `top tick ${topTick}, largest value ${Math.max(...fuels).toFixed(2)}`,
);

// ---- Provenance is on every figure -----------------------------------------
const provenance = await page.evaluate(() => {
  const tiles = [...document.querySelectorAll('.stat-tile')];
  return {
    tiles: tiles.length,
    tagged: tiles.filter((t) => t.querySelector('.provenance')).length,
    kinds: [...new Set([...document.querySelectorAll('.provenance')].map((p) => p.textContent))],
  };
});
check(
  'every headline figure says where it came from',
  provenance.tiles > 0 && provenance.tiles === provenance.tagged,
  `${provenance.tagged}/${provenance.tiles} tiles tagged`,
);
check(
  'all three provenance kinds are used',
  ['simulated', 'derived', 'published'].every((k) => provenance.kinds.includes(k)),
  provenance.kinds.join(', '),
);

// ---- The drag bar is a part-to-whole and adds up ----------------------------
const drag = await page.evaluate(() => {
  const pieces = [...document.querySelectorAll('.drag-piece')];
  const parent = document.querySelector('.drag-bar');
  if (!parent) return null;
  const total = parent.getBoundingClientRect().width;
  return {
    count: pieces.length,
    covered: pieces.reduce((sum, p) => sum + p.getBoundingClientRect().width, 0),
    total,
    titles: pieces.map((p) => p.title),
  };
});
check('the drag bar has segments', drag && drag.count >= 2, `${drag?.count} segments`);
check(
  'the segments fill the bar',
  // Allowing for the 2px surface gaps between them.
  Math.abs(drag.total - drag.covered) <= 2 * drag.count + 1,
  `${drag.covered.toFixed(1)} of ${drag.total.toFixed(1)} px`,
);

// ---- The table view shows the same data ------------------------------------
await page.click('.analysis-section-head .chip');
await page.waitForSelector('.analysis-section .analysis-table');
const rows = await page.evaluate(
  () => document.querySelectorAll('.analysis-section-head + .analysis-caption + .analysis-table tbody tr').length,
);
check('the table view lists the roster', rows >= 20, `${rows} rows`);

// ---- Escape closes it -------------------------------------------------------
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
check('escape closes the sheet', await page.isHidden('#analysis'));

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nAll analysis checks passed.');
