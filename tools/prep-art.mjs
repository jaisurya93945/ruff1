#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   Turns a source illustration into everything a theme needs:

     <id>.webp        full-bleed backdrop (max 1400px tall)
     <id>-card.webp   theme-picker portrait (max 700px tall)
     <id>.json        palette + a blurred placeholder data-URI

   The palette is read out of the artwork, so the whole UI takes
   its colour from the character rather than from a hand-picked
   guess that never quite matches.

   Uses the Chromium that Playwright already ships — no image
   libraries, nothing added to package.json.

     node tools/prep-art.mjs
   ═══════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, 'images/chars');

/* Area-ranking alone picks backgrounds — foliage, sand, bedding — over the
   thing that actually identifies a character. `prefer` names the hues worth
   leading with; the tool still reads the real colour out of the artwork at
   those hues, it just knows where to look. Drop a character's entry and it
   falls back to pure ranking. */
const PREFER = {
  aoi:   [186, 212, 268],   // ribbons, eyes, a cool violet to round it out
  nyx:   [335, 45, 280],    // bedding, lamp, eyes
  mizu:  [188, 262, 40],    // sea, eyes, sand
  kaede: [342, 205, 165],   // hair, night sky, onsen water
};

const BACKDROP_MAX = 1400;
const CARD_MAX = 700;
const QUALITY = 0.86;

function loadChromium() {
  const require = createRequire(import.meta.url);
  for (const n of ['playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(n).chromium; } catch {}
  }
  return null;
}

const chromium = loadChromium();
if (!chromium) {
  console.error('Playwright not found. npm i -D playwright, then re-run.');
  process.exit(1);
}

const sources = readdirSync(DIR).filter(f => /-src\.(png|jpe?g|webp)$/i.test(f)).sort();
if (!sources.length) {
  console.error(`No *-src.png in ${DIR}. Drop your artwork there first.`);
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
await page.goto('about:blank');

const index = {};

for (const file of sources) {
  const id = file.replace(/-src\.\w+$/i, '');
  const ext = file.split('.').pop().toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const dataUrl = `data:${mime};base64,${readFileSync(resolve(DIR, file)).toString('base64')}`;

  const out = await page.evaluate(async ({ dataUrl, BACKDROP_MAX, CARD_MAX, QUALITY, prefer }) => {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('decode failed'));
      i.src = dataUrl;
    });

    /* Normalise every character to the same aspect. Sources arrive square,
       tall, whatever — and a square one anchored right sprawls twice as wide
       as a portrait, which makes the layout unpredictable. Cover-crop to a
       fixed ratio biased toward the top, where faces live. */
    const draw = (maxH, ratio) => {
      const h = Math.min(maxH, Math.round(img.height * 1.6));
      const w = Math.round(h * ratio);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingQuality = 'high';

      const scale = Math.max(w / img.width, h / img.height);   // cover
      const dw = img.width * scale, dh = img.height * scale;
      const dx = (w - dw) / 2;                                  // centred across
      const dy = (h - dh) * 0.18;                               // biased to the top
      ctx.drawImage(img, dx, dy, dw, dh);
      return { cv, w, h };
    };

    const big = draw(BACKDROP_MAX, 2 / 3);
    const card = draw(CARD_MAX, 3 / 4);

    /* a 20px-wide blur, inlined as a data URI so the backdrop never
       flashes empty while the real image streams in */
    const lq = document.createElement('canvas');
    lq.width = 20; lq.height = Math.max(1, Math.round(20 * img.height / img.width));
    lq.getContext('2d').drawImage(img, 0, 0, lq.width, lq.height);

    /* ── palette ─────────────────────────────────────────── */
    const S = 96;
    const pc = document.createElement('canvas');
    pc.width = S; pc.height = S;
    const pctx = pc.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(img, 0, 0, S, S);
    const { data } = pctx.getImageData(0, 0, S, S);

    const rgbToHsl = (r, g, b) => {
      r /= 255; g /= 255; b /= 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      let h = 0;
      if (d) {
        if (mx === r) h = ((g - b) / d) % 6;
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60; if (h < 0) h += 360;
      }
      const l = (mx + mn) / 2;
      return [h, d ? d / (1 - Math.abs(2 * l - 1)) : 0, l];
    };

    const HUES = 36;
    const bins = Array.from({ length: HUES }, () => ({ w: 0, h: 0, s: 0, l: 0 }));
    let darkL = 1, darkH = 0, darkS = 0, darkCount = 0;

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 140) continue;
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      // track the darker end of the image for the page background
      if (l < 0.38) { darkL += l; darkH += h; darkS += s; darkCount++; }
      if (l < 0.14 || l > 0.93 || s < 0.14) continue;

      // Square the saturation so vivid colour beats large flat areas, then
      // discount the warm neutrals — skin, brown hair, sand, wood, all of
      // which dominate character art by area and all of which lift into the
      // same washed-out beige. Genuinely vivid warms (s >= .72: a gold lamp,
      // orange hair) survive the filter.
      const warmNeutral = h >= 5 && h <= 50 && s < 0.72;
      let weight = s * s * (1 - Math.abs(l - 0.55) * 1.1);
      if (warmNeutral) weight *= 0.06;
      if (weight <= 0.004) continue;
      const bin = bins[Math.floor(h / (360 / HUES)) % HUES];
      bin.w += weight; bin.h += h * weight; bin.s += s * weight; bin.l += l * weight;
    }

    const ranked = bins.filter(b => b.w > 0)
      .map(b => ({ w: b.w, h: b.h / b.w, s: b.s / b.w, l: b.l / b.w }))
      .sort((a, b) => b.w - a.w);

    const hueGap = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 360 - d); };
    const picked = [];

    if (prefer) {
      // take the strongest real colour near each preferred hue
      for (const want of prefer) {
        const near = ranked
          .filter(c => hueGap(c.h, want) < 26 && !picked.includes(c))
          .sort((a, b) => b.w - a.w)[0];
        if (near) picked.push(near);
        else {
          // that hue is not in the image — borrow its character's saturation
          const ref = picked[0] || ranked[0] || { s: 0.6, l: 0.55 };
          picked.push({ w: 0, h: want, s: Math.max(ref.s, 0.55), l: 0.58 });
        }
      }
    }

    // fill any gaps from the ranking, keeping the hues distinct
    for (const c of ranked) {
      if (picked.length >= 3) break;
      if (picked.every(p => hueGap(p.h, c.h) > 28)) picked.push(c);
    }
    while (picked.length < 3) {
      const base = picked[0] || { h: 200, s: 0.6, l: 0.58 };
      picked.push({ ...base, h: (base.h + 40 * picked.length) % 360 });
    }
    picked.length = 3;

    const clamp = (v, a, z) => Math.max(a, Math.min(z, v));
    const hsl = (h, s, l) => `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;
    // lift each pick into a band that stays readable on dark and light
    const accent = picked.map((c, i) =>
      hsl(c.h, clamp(c.s < 0.4 ? c.s + 0.28 : c.s, 0.46, 0.94), clamp(c.l + (i ? 0.04 : 0), 0.56, 0.74)));
    const accentLight = picked.map(c =>
      hsl(c.h, clamp(c.s, 0.5, 0.95), clamp(c.l - 0.16, 0.3, 0.46)));

    const dh = darkCount ? darkH / darkCount : picked[0].h;
    const ds = darkCount ? clamp(darkS / darkCount, 0.15, 0.55) : 0.3;

    return {
      backdrop: big.cv.toDataURL('image/webp', QUALITY),
      card: card.cv.toDataURL('image/webp', QUALITY),
      lqip: lq.toDataURL('image/webp', 0.6),
      size: { w: big.w, h: big.h },
      palette: {
        accent, accentLight,
        hue: picked.map(c => Math.round(c.h)),
        dark: { h: Math.round(dh), s: +ds.toFixed(2) },
      },
    };
  }, { dataUrl, BACKDROP_MAX, CARD_MAX, QUALITY, prefer: PREFER[id] || null });

  const b64 = (u) => Buffer.from(u.split(',')[1], 'base64');
  const bd = b64(out.backdrop), cd = b64(out.card);
  writeFileSync(resolve(DIR, `${id}.webp`), bd);
  writeFileSync(resolve(DIR, `${id}-card.webp`), cd);

  index[id] = { ...out.palette, lqip: out.lqip, size: out.size };

  const src = readFileSync(resolve(DIR, file)).length;
  console.log(`  ✓ ${id}  ${out.size.w}×${out.size.h}  ` +
    `backdrop ${(bd.length / 1024).toFixed(0)}KB  card ${(cd.length / 1024).toFixed(0)}KB  ` +
    `(source ${(src / 1024).toFixed(0)}KB → ${((1 - (bd.length + cd.length) / src) * 100).toFixed(0)}% smaller)  ` +
    `hues ${out.palette.hue.join('/')}`);
}

await browser.close();
writeFileSync(resolve(DIR, 'palettes.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`\n${Object.keys(index).length} characters processed → images/chars/palettes.json`);
