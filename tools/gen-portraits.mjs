#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   Generates the nine theme portraits in images/themes/.

   These are original, hand-parameterised anime-style SVGs —
   nothing copied, nothing downloaded, so the repo stays clean.
   Swap any of them for your own art: drop a PNG/JPG at
   images/themes/<id>.png and the app prefers it automatically.

     node tools/gen-portraits.mjs
   ═══════════════════════════════════════════════════════════ */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'images/themes');

/* ── the cast ─────────────────────────────────────────────── */
const CHARACTERS = [
  { id:'sakura', name:'Sakura',  hair:['#ffa9d4','#f56aa8','#c93f7e'], eye:['#ff8ec2','#8b2f68'], skin:'#ffe3d8', style:'wavy',     accessory:'blossom', outfit:['#ffd3e6','#f79fc6'] },
  { id:'neon',   name:'Rin',     hair:['#7ef5ff','#28c8ff','#1b6ad1'], eye:['#63ffe0','#0c6a7a'], skin:'#ffdfd2', style:'bob',      accessory:'phones',  outfit:['#16324d','#0d2036'] },
  { id:'yuki',   name:'Yuki',    hair:['#eaf2ff','#b9d2f7','#7f9dd1'], eye:['#a9c9ff','#2f4a7a'], skin:'#ffe7dd', style:'hime',     accessory:'flake',   outfit:['#dbe7fb','#a8bfe0'] },
  { id:'ember',  name:'Hana',    hair:['#ffbe63','#ff7a2f','#d0401a'], eye:['#ffb44d','#8a3b0c'], skin:'#ffdcc8', style:'ponytail', accessory:'flame',   outfit:['#3a1b12','#5d2a17'] },
  { id:'mint',   name:'Aoi',     hair:['#9ff7dc','#3fd8b4','#1c9c86'], eye:['#63f0d0','#0d6355'], skin:'#ffe5d9', style:'twin',     accessory:'ribbon',  outfit:['#e8fffa','#b6ece0'] },
  { id:'violet', name:'Nocturne',hair:['#c9b0ff','#9b6dfa','#5e35c4'], eye:['#c3a4ff','#3c2075'], skin:'#ffe2da', style:'hime',     accessory:'moon',    outfit:['#241a42','#3b2a6b'] },
  { id:'hikari', name:'Hikari',  hair:['#ffe795','#ffcb3d','#d99a10'], eye:['#ffd86b','#8a6208'], skin:'#ffe4d2', style:'wavy',     accessory:'star',    outfit:['#fff4d4','#f6dc9a'] },
  { id:'kurone', name:'Kurone',  hair:['#3c4a44','#1d2723','#0d1411'], eye:['#a6ff7d','#2d6b22'], skin:'#f6dccf', style:'bob',      accessory:'choker',  outfit:['#121a17','#1f2e28'] },
  { id:'mono',   name:'Null',    hair:['#e6e6ee','#b4b4c2','#7c7c8c'], eye:['#c8c8d6','#3a3a46'], skin:'#f2e6df', style:'ponytail', accessory:'pin',     outfit:['#25252d','#3a3a46'] },
];

/* ── hair shapes ──────────────────────────────────────────── */
const BACK_HAIR = {
  wavy:`M200 52C118 52 74 114 70 204c-4 86-14 196-16 318-1 46 12 74 36 82l22-54c-14-98-8-196 6-266-14-70-8-140 82-162 90 22 96 92 82 162 14 70 20 168 6 266l22 54c24-8 37-36 36-82-2-122-12-232-16-318-4-90-48-152-130-152Z`,
  bob:`M200 54C126 54 84 108 80 188c-3 58-6 108-8 150 24 16 52 24 84 26-18-40-22-92-16-136-10-62 6-108 60-124 54 16 70 62 60 124 6 44 2 96-16 136 32-2 60-10 84-26-2-42-5-92-8-150-4-80-46-134-120-134Z`,
  hime:`M200 50C114 50 70 116 68 210c-2 96-6 220-8 330h54c-6-110-4-232 2-320-8-78 14-126 84-142 70 16 92 64 84 142 6 88 8 210 2 320h54c-2-110-6-234-8-330-2-94-46-160-132-160Z`,
  ponytail:`M200 54C124 54 82 112 78 200c-3 62-8 124-12 170l52 10c2-52 6-104 10-150-8-66 12-110 72-126 60 16 80 60 72 126 4 46 8 98 10 150l52-10c-4-46-9-108-12-170-4-88-46-146-122-146Z M300 150c34 18 52 58 56 108 5 62-6 130-30 190-10 26-28 44-48 48l-16-42c16-6 28-20 34-40 18-56 24-116 18-166-4-38-14-68-34-84Z`,
  twin:`M200 54C126 54 84 110 80 196c-2 44-5 88-8 124l50 8c2-42 5-86 8-126-8-64 12-106 70-122 58 16 78 58 70 122 3 40 6 84 8 126l50-8c-3-36-6-80-8-124-4-86-46-142-120-142Z M84 230c-26 16-40 52-42 102-2 54 6 112 22 160l50-14c-14-42-20-94-18-142 2-42 10-72 24-88Z M316 230c26 16 40 52 42 102 2 54-6 112-22 160l-50-14c14-42 20-94 18-142-2-42-10-72-24-88Z`,
};

const BANGS = {
  wavy:`M106 196c-6-74 32-128 94-128s100 54 94 128c-8-20-20-36-36-46l-14 44-18-48c-10 16-26 26-46 24l-14 34-18-56c-18 12-34 28-42 48Z`,
  bob:`M104 192c-4-76 34-126 96-126s100 50 96 126c-10-22-24-38-42-48l-10 42-20-46c-12 14-30 22-50 20l-12 36-16-52c-18 12-32 28-42 48Z`,
  hime:`M104 198c-4-78 34-130 96-130s100 52 96 130c-6-24-16-42-30-54l-8 48-16-52c-14 16-34 24-58 22l-10 42-14-58c-22 10-42 30-56 52Z`,
  ponytail:`M108 190c-6-72 32-122 92-122s98 50 92 122c-10-20-24-34-42-42l-8 36-22-42c-14 12-34 18-56 14l-10 32-14-48c-16 12-30 30-32 50Z`,
  twin:`M106 194c-4-76 34-126 94-126s98 50 94 126c-8-22-22-38-38-46l-12 40-18-44c-12 14-30 20-48 18l-12 34-16-50c-18 12-34 28-44 48Z`,
};

const SIDE_LOCKS = {
  wavy:`M112 176c-10 70-6 142 8 200l30-8c-14-58-18-128-8-196Z M288 176c10 70 6 142-8 200l-30-8c14-58 18-128 8-196Z`,
  bob:`M106 178c-6 46-4 92 4 130l28-8c-8-38-10-84-4-126Z M294 178c6 46 4 92-4 130l-28-8c8-38 10-84 4-126Z`,
  hime:`M104 174c-8 78-6 162 6 236l34-8c-12-72-14-156-6-232Z M296 174c8 78 6 162-6 236l-34-8c12-72 14-156 6-232Z`,
  ponytail:`M110 180c-8 56-6 114 4 158l28-8c-10-44-12-102-4-154Z M290 180c8 56 6 114-4 158l-28-8c10-44 12-102 4-154Z`,
  twin:`M110 178c-8 60-6 120 4 166l28-8c-10-46-12-108-4-162Z M290 178c8 60 6 120-4 166l-28-8c10-46 12-108 4-162Z`,
};

/* ── accessories ──────────────────────────────────────────── */
function accessory(kind, c) {
  const A = c.hair[0], B = c.hair[2], E = c.eye[0];
  switch (kind) {
    case 'blossom': return `
      <g transform="translate(286 148) rotate(14)">
        ${[0,72,144,216,288].map(a=>`<ellipse cx="0" cy="-17" rx="10" ry="18" fill="#fff0f7" stroke="#f9a8cd" stroke-width="2" transform="rotate(${a})"/>`).join('')}
        <circle r="7" fill="#ffd166"/>
      </g>`;
    case 'phones': return `
      <path d="M96 200a104 104 0 0 1 208 0" fill="none" stroke="${B}" stroke-width="13" stroke-linecap="round"/>
      <rect x="76" y="186" width="34" height="56" rx="15" fill="${B}"/>
      <rect x="290" y="186" width="34" height="56" rx="15" fill="${B}"/>
      <rect x="84" y="198" width="18" height="32" rx="9" fill="${E}" opacity=".9"/>
      <rect x="298" y="198" width="18" height="32" rx="9" fill="${E}" opacity=".9"/>`;
    case 'flake': return `
      <g transform="translate(288 140)" stroke="#eaf4ff" stroke-width="3.4" stroke-linecap="round" fill="none">
        ${[0,60,120].map(a=>`<g transform="rotate(${a})"><path d="M-22 0h44"/><path d="M-14-7l-8 7 8 7"/><path d="M14-7l8 7-8 7"/></g>`).join('')}
        <circle r="4.5" fill="#eaf4ff" stroke="none"/>
      </g>`;
    case 'flame': return `
      <g transform="translate(290 146)">
        <path d="M0-26c12 12 18 22 18 32a18 18 0 0 1-36 0c0-10 6-20 18-32Z" fill="${A}"/>
        <path d="M0-12c6 7 9 12 9 17a9 9 0 0 1-18 0c0-5 3-10 9-17Z" fill="#fff3c4"/>
      </g>`;
    case 'ribbon': return `
      <g transform="translate(112 158) rotate(-16)">
        <path d="M0 0-34-18v36Z" fill="${A}"/><path d="M0 0 34-18v36Z" fill="${A}"/>
        <circle r="9" fill="${B}"/>
      </g>
      <g transform="translate(288 158) rotate(16)">
        <path d="M0 0-34-18v36Z" fill="${A}"/><path d="M0 0 34-18v36Z" fill="${A}"/>
        <circle r="9" fill="${B}"/>
      </g>`;
    case 'moon': return `
      <g transform="translate(286 144)">
        <path d="M0-24a24 24 0 1 0 17 41A19 19 0 0 1 0-24Z" fill="#f4ecff"/>
        <circle cx="22" cy="14" r="3.4" fill="#f4ecff"/><circle cx="-24" cy="20" r="2.6" fill="#f4ecff"/>
      </g>`;
    case 'star': return `
      <g transform="translate(288 142)">
        <path d="M0-24 7-7l18 2-13 13 3 18L0 18l-15 8 3-18-13-13 18-2Z" fill="#fff0b8" stroke="${B}" stroke-width="2"/>
      </g>`;
    case 'choker': return `
      <rect x="164" y="316" width="72" height="16" rx="8" fill="#12100f"/>
      <circle cx="200" cy="324" r="7" fill="${E}"/>
      <path d="M200 331v16" stroke="#12100f" stroke-width="3"/>
      <circle cx="200" cy="352" r="6" fill="${E}" opacity=".8"/>`;
    default: return `
      <g transform="translate(286 150) rotate(-12)">
        <rect x="-19" y="-5" width="38" height="10" rx="5" fill="${A}"/>
        <circle cx="-19" cy="0" r="6.5" fill="${B}"/>
      </g>`;
  }
}

/* ── the portrait ─────────────────────────────────────────── */
function portrait(c) {
  const [h1, h2, h3] = c.hair;
  const [e1, e2] = c.eye;
  const [o1, o2] = c.outfit;
  const id = c.id;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 620" width="400" height="620" role="img" aria-label="${c.name}, the ${id} theme portrait">
<defs>
  <linearGradient id="hair-${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${h1}"/><stop offset=".55" stop-color="${h2}"/><stop offset="1" stop-color="${h3}"/>
  </linearGradient>
  <linearGradient id="hairF-${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${h1}"/><stop offset="1" stop-color="${h2}"/>
  </linearGradient>
  <linearGradient id="skin-${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${c.skin}"/><stop offset="1" stop-color="${shade(c.skin, -12)}"/>
  </linearGradient>
  <linearGradient id="fit-${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${o1}"/><stop offset="1" stop-color="${o2}"/>
  </linearGradient>
  <radialGradient id="iris-${id}" cx=".5" cy=".34" r=".72">
    <stop offset="0" stop-color="${e1}"/><stop offset=".62" stop-color="${e1}"/><stop offset="1" stop-color="${e2}"/>
  </radialGradient>
  <radialGradient id="glow-${id}" cx=".5" cy=".42" r=".6">
    <stop offset="0" stop-color="${h1}" stop-opacity=".55"/><stop offset="1" stop-color="${h1}" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="face-${id}">
    <path d="M124 196c0-62 30-98 76-98s76 36 76 98c0 50-32 100-76 118-44-18-76-68-76-118Z"/>
  </clipPath>
</defs>

<ellipse cx="200" cy="300" rx="200" ry="260" fill="url(#glow-${id})"/>

<!-- hair, back layer -->
<path d="${BACK_HAIR[c.style]}" fill="url(#hair-${id})"/>

<!-- shoulders -->
<path d="M200 322c-16 0-30 10-34 26-52 14-88 54-96 112-6 44-8 100-8 160h276c0-60-2-116-8-160-8-58-44-98-96-112-4-16-18-26-34-26Z" fill="url(#fit-${id})"/>
<path d="M166 348c10 22 20 34 34 34s24-12 34-34l-16-8c-6 10-11 14-18 14s-12-4-18-14Z" fill="${shade(c.skin,-6)}"/>

<!-- neck -->
<path d="M176 268h48v54c0 12-10 20-24 20s-24-8-24-20Z" fill="${shade(c.skin,-14)}"/>

<!-- face -->
<path d="M124 196c0-62 30-98 76-98s76 36 76 98c0 50-32 100-76 118-44-18-76-68-76-118Z" fill="url(#skin-${id})"/>
<g clip-path="url(#face-${id})">
  <ellipse cx="160" cy="246" rx="19" ry="9" fill="#ff8fa8" opacity=".3"/>
  <ellipse cx="240" cy="246" rx="19" ry="9" fill="#ff8fa8" opacity=".3"/>
</g>
<ellipse cx="126" cy="214" rx="9" ry="14" transform="rotate(-14 126 214)" fill="${shade(c.skin,-10)}"/>
<ellipse cx="274" cy="214" rx="9" ry="14" transform="rotate(14 274 214)" fill="${shade(c.skin,-10)}"/>

<!-- eyes -->
${eye(160, 214, id, e2, false)}
${eye(240, 214, id, e2, true)}

<!-- brows -->
<path d="M138 186c8-8 24-11 38-6" fill="none" stroke="${h3}" stroke-width="5" stroke-linecap="round" opacity=".82"/>
<path d="M262 186c-8-8-24-11-38-6" fill="none" stroke="${h3}" stroke-width="5" stroke-linecap="round" opacity=".82"/>

<!-- nose + mouth -->
<path d="M200 244c3 4 6 6 9 7" fill="none" stroke="${shade(c.skin,-30)}" stroke-width="3" stroke-linecap="round" opacity=".7"/>
<path d="M188 274c5 7 19 7 24 0" fill="none" stroke="#c2606a" stroke-width="3.6" stroke-linecap="round"/>

<!-- hair, front -->
<path d="${SIDE_LOCKS[c.style]}" fill="url(#hairF-${id})"/>
<path d="${BANGS[c.style]}" fill="url(#hairF-${id})"/>
<path d="M150 104c22-14 60-18 92-4" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".28"/>

${accessory(c.accessory, c)}
</svg>`;
}

function eye(cx, cy, id, lash, flip) {
  const s = flip ? -1 : 1;
  return `<g transform="translate(${cx} ${cy}) scale(${s} 1)">
  <path d="M-25-6c3-13 14-20 25-20s22 7 25 20c2 18-10 32-25 32S-27 12-25-6Z" fill="#fffdfa"/>
  <ellipse cx="0" cy="4" rx="17" ry="20" fill="url(#iris-${id})"/>
  <ellipse cx="0" cy="5" rx="7.5" ry="10" fill="#1a1320" opacity=".9"/>
  <circle cx="-6" cy="-5" r="5.6" fill="#fff" opacity=".95"/>
  <circle cx="6" cy="11" r="3" fill="#fff" opacity=".6"/>
  <path d="M-27-8c4-15 15-23 27-23s23 8 27 23" fill="none" stroke="${lash}" stroke-width="7.5" stroke-linecap="round"/>
  <path d="M-27-8c-4-3-8-4-11-3" fill="none" stroke="${lash}" stroke-width="6" stroke-linecap="round"/>
</g>`;
}

/** lighten/darken a hex colour by a percentage */
function shade(hex, pct) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v =>
    Math.max(0, Math.min(255, Math.round(v + 255 * (pct / 100)))));
  return '#' + ch.map(v => v.toString(16).padStart(2, '0')).join('');
}

/* ── write them out ───────────────────────────────────────── */
mkdirSync(OUT, { recursive: true });
for (const c of CHARACTERS) {
  const svg = portrait(c);
  writeFileSync(resolve(OUT, `${c.id}.svg`), svg);
  console.log(`  ✓ images/themes/${c.id}.svg  (${c.name}, ${svg.length.toLocaleString()} bytes)`);
}
console.log(`\n${CHARACTERS.length} portraits written to images/themes/`);
