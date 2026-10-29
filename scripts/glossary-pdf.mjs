/**
 * Render GLOSSARY.md to a PDF any reader can open.
 *
 * Markdown is plain text: opened in a default viewer the asterisks, pipes and hashes
 * show up as literal punctuation and the tables collapse into noise. This turns it into
 * a typeset document.
 *
 * Two steps, because each tool does the part it is good at. Pandoc parses the Markdown -
 * worth using rather than hand-rolling, since tables and nested emphasis are where a
 * naive converter quietly gets it wrong. Chromium then prints the result, which is the
 * only PDF engine installed here and gives real control over page breaks and type.
 *
 * Usage: npm run glossary:pdf
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { chromium } from 'playwright';

const SOURCE = process.argv[2] ?? 'GLOSSARY.md';
const OUT = process.argv[3] ?? 'GLOSSARY.pdf';

const body = execFileSync('pandoc', [SOURCE, '-f', 'gfm', '-t', 'html5'], {
  encoding: 'utf8',
  maxBuffer: 1 << 24,
});

/*
 * Printed, not screened. Dark backgrounds waste ink and read badly on paper, so this is
 * a light document whatever the app looks like; the one piece of colour is the accent on
 * headings, which is the app's own blue darkened enough to pass contrast on white.
 */
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Glossary</title>
<style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    font: 10.5pt/1.55 "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #15181d;
  }
  h1 {
    font-size: 25pt; margin: 0 0 2pt; letter-spacing: -0.01em;
    color: #0b0e13;
  }
  h1 + p { color: #4a5159; font-size: 10pt; margin-top: 0; }
  h2 {
    font-size: 13.5pt; margin: 20pt 0 7pt; padding-bottom: 3pt;
    color: #1f5fa8; border-bottom: 0.6pt solid #c9d3df;
    /* A heading alone at the foot of a page is the classic print fault. */
    break-after: avoid; break-inside: avoid;
  }
  /* Each definition is one paragraph and should never be split across a page. */
  p { margin: 0 0 7pt; break-inside: avoid; orphans: 3; widows: 3; }
  strong { color: #0b0e13; }
  ul { margin: 0 0 8pt; padding-left: 16pt; }
  li { margin-bottom: 3pt; break-inside: avoid; }
  hr { border: 0; border-top: 0.6pt solid #dde3ea; margin: 16pt 0; }
  blockquote {
    margin: 7pt 0 9pt; padding: 6pt 10pt;
    border-left: 2.5pt solid #1f5fa8; background: #f2f6fa;
    color: #2d343c; break-inside: avoid;
  }
  blockquote p:last-child { margin-bottom: 0; }
  code {
    font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 9.2pt;
    background: #eef2f6; padding: 0.5pt 3pt; border-radius: 2pt;
  }
  table {
    border-collapse: collapse; width: 100%; margin: 8pt 0 10pt;
    font-size: 9.5pt; break-inside: avoid;
  }
  th, td { border: 0.6pt solid #c9d3df; padding: 4pt 7pt; text-align: left; vertical-align: top; }
  th { background: #eef2f6; color: #0b0e13; }
</style></head><body>
${body}
</body></html>`;

const tmp = `${OUT}.tmp.html`;
writeFileSync(tmp, html);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--no-proxy-server'],
});
const page = await browser.newPage();
await page.goto(`file://${process.cwd()}/${tmp}`, { waitUntil: 'load' });
await page.pdf({
  path: OUT,
  format: 'A4',
  printBackground: true,
  margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate:
    '<div style="width:100%;font:8pt Helvetica,Arial,sans-serif;color:#8a929b;' +
    'padding:0 16mm;display:flex;justify-content:space-between;">' +
    '<span>Wind Tunnel Simulator — Glossary</span>' +
    '<span class="pageNumber"></span></div>',
});
await browser.close();
unlinkSync(tmp);

const bytes = readFileSync(OUT).length;
console.log(`${OUT} — ${(bytes / 1024).toFixed(0)} kB`);
