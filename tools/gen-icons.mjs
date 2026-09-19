#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   Renders the PWA icons into images/ from one SVG source.
   Needs Playwright (for a headless Chromium) — it is only
   needed when you want to change the mark:

     npm i -D playwright && node tools/gen-icons.mjs
   ═══════════════════════════════════════════════════════════ */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'images');

/** the AURA mark: a soft gradient field, the chevron, an orbit ring */
const mark = (size, { padding = 0.12, rounded = true } = {}) => {
  const p = size * padding;
  const inner = size - p * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a1024"/><stop offset=".55" stop-color="#160a14"/><stop offset="1" stop-color="#0d0610"/>
    </linearGradient>
    <linearGradient id="fg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff7eb6"/><stop offset=".45" stop-color="#ffa8d2"/><stop offset="1" stop-color="#b96cf0"/>
    </linearGradient>
    <radialGradient id="glow" cx=".5" cy=".38" r=".62">
      <stop offset="0" stop-color="#ff7eb6" stop-opacity=".55"/><stop offset="1" stop-color="#ff7eb6" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${rounded ? size * 0.22 : 0}" fill="url(#bg)"/>
  <circle cx="${size / 2}" cy="${size * 0.44}" r="${size * 0.42}" fill="url(#glow)"/>
  <g transform="translate(${p} ${p}) scale(${inner / 24})">
    <path d="M12 2.6 4.2 20.4a.7.7 0 0 0 .95.9L12 18l6.85 3.3a.7.7 0 0 0 .95-.9Z" fill="url(#fg)"/>
    <circle cx="12" cy="11" r="3.1" fill="none" stroke="#fff" stroke-opacity=".82" stroke-width="1.5"/>
  </g>
</svg>`;
};

async function loadChromium() {
  const require = createRequire(import.meta.url);
  const candidates = ['playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright'];
  for (const name of candidates) {
    try { return require(name).chromium; } catch {}
  }
  return null;
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, padding: 0.16 },
  { file: 'icon-512.png', size: 512, padding: 0.16 },
  { file: 'icon-maskable.png', size: 512, padding: 0.26, rounded: false },
  { file: 'favi.png', size: 180, padding: 0.14 },
];

mkdirSync(OUT, { recursive: true });

const chromium = await loadChromium();
if (!chromium) {
  // no browser available — write the SVG so the mark is still versioned
  writeFileSync(resolve(OUT, 'icon.svg'), mark(512, { padding: 0.16 }));
  console.log('Playwright not found — wrote images/icon.svg only.');
  console.log('Install it (npm i -D playwright) and re-run to produce the PNGs.');
  process.exit(0);
}

const browser = await chromium.launch();
for (const t of TARGETS) {
  const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<body style="margin:0;background:transparent">${mark(t.size, { padding: t.padding, rounded: t.rounded !== false })}</body>`);
  const buf = await page.screenshot({ omitBackground: true });
  writeFileSync(resolve(OUT, t.file), buf);
  await page.close();
  console.log(`  ✓ images/${t.file}  (${t.size}×${t.size}, ${(buf.length / 1024).toFixed(1)} KB)`);
}
await browser.close();
console.log('\nIcons written.');
