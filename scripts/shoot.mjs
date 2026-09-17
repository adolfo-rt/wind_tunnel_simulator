// Launch the built app in headless Chromium, select aircraft, capture screenshots and
// report any console errors. Used to check each stage without a human in the loop.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.env.APP_URL ?? 'http://localhost:4173';
const outDir = process.env.SHOT_DIR ?? 'shots';
const ids = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

// This environment ships one Chromium build that may not match the Playwright
// package's expected revision, so point at it explicitly rather than downloading.
// SwiftShader gives us a software WebGL2 context, which is slow but renders faithfully.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    // This sandbox exports an HTTPS proxy; without this Chromium sends the loopback
    // request to it and every asset comes back 404.
    '--no-proxy-server',
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}\n${e.stack ?? ''}`));
page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`);
});

for (const id of ids) {
  await page.goto(`${base}/#${id}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, {
    timeout: 20000,
  });
  // Let the camera move settle and a few frames render.
  await page.waitForTimeout(1200);
  if (process.env.HIDE_UI) {
    await page.addStyleTag({ content: '#selector,#info,.hint{display:none !important}' });
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: `${outDir}/${id}.png` });
  console.log(`captured ${id}`);
}

// A blank canvas is the classic silent WebGL failure, so check there is real variance.
const stats = await page.evaluate(() => {
  const canvas = document.getElementById('viewport');
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  return { width: canvas.width, height: canvas.height, hasContext: !!gl };
});
console.log('canvas', JSON.stringify(stats));

await browser.close();
if (problems.length) {
  console.log('--- console problems ---');
  for (const p of problems) console.log(p);
}
