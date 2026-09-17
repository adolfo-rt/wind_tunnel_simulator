// Capture side, top and front views of one aircraft so generated geometry can be
// checked properly rather than guessed at from a three-quarter view.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.env.APP_URL ?? 'http://127.0.0.1:4173/wind_tunnel_simulator';
const outDir = process.env.SHOT_DIR ?? 'shots';
const id = process.argv[2] ?? 'boeing747-100';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));

await page.goto(`${base}/#${id}`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, { timeout: 20000 });
await page.waitForTimeout(800);

// Hide the panels so nothing overlaps the aeroplane.
await page.addStyleTag({ content: '#selector,#info,.hint{display:none !important}' });

for (const which of ['side', 'top', 'front']) {
  await page.evaluate((w) => window.windTunnel.view(w), which);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${outDir}/${id}-${which}.png` });
  console.log(`captured ${id}-${which}`);
}

await browser.close();
