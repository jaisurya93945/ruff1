#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   Generates the nine theme portraits in images/themes/.

   Original, parameterised anime-style SVGs — nothing copied,
   nothing downloaded, so the repo stays clean.

   Proportions aim mature rather than chibi: the eye-to-face
   ratio is the single biggest cue, so eyes sit at roughly a
   third of the face width instead of half, the jaw tapers
   rather than rounds, brows are thin and high, and the neck is
   long. Hair is built in layers — back mass, strand cluster,
   highlight band — instead of one flat silhouette.

   Swap any of them for your own art: images/themes/overrides.json
   or the + button on a theme card in the app.

     node tools/gen-portraits.mjs
   ═══════════════════════════════════════════════════════════ */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'images/themes');

/* ── the cast ─────────────────────────────────────────────── */
const CHARACTERS = [
  { id:'sakura', name:'Sakura',   hair:['#ffb3d9','#f26fae','#b83a7a'], eye:['#ff7fb8','#7d2352'], skin:'#fbdccb', lip:'#d4647f', style:'long',     accessory:'blossom', outfit:['#3a1f33','#5c3350'], top:'offshoulder' },
  { id:'neon',   name:'Rin',      hair:['#8ff0ff','#22c3f5','#1359a8'], eye:['#5ef0d8','#0a5f6e'], skin:'#fbdac6', lip:'#c25f74', style:'bob',      accessory:'phones',  outfit:['#0f2438','#173754'], top:'jacket' },
  { id:'yuki',   name:'Yuki',     hair:['#f2f7ff','#c3d6f2','#8aa4cc'], eye:['#9dc2ff','#26406e'], skin:'#fbe0d2', lip:'#c96f83', style:'hime',     accessory:'flake',   outfit:['#26344d','#3d5273'], top:'collar' },
  { id:'ember',  name:'Hana',     hair:['#ffc879','#ff8434','#c93f12'], eye:['#ffab3d','#7a3208'], skin:'#f9d6bd', lip:'#c4515f', style:'ponytail', accessory:'flame',   outfit:['#31170f','#4d2417'], top:'jacket' },
  { id:'mint',   name:'Aoi',      hair:['#aef7e0','#3fd6b4','#158f7c'], eye:['#54ecc9','#0b5a4e'], skin:'#fbdfcf', lip:'#cc6b7d', style:'twin',     accessory:'ribbon',  outfit:['#17423c','#215f54'], top:'collar' },
  { id:'violet', name:'Nocturne', hair:['#d4bcff','#9a6cf5','#5a31b8'], eye:['#c2a3ff','#341a6b'], skin:'#f9dcd0', lip:'#b95a76', style:'hime',     accessory:'moon',    outfit:['#1f1740','#342563'], top:'offshoulder' },
  { id:'hikari', name:'Hikari',   hair:['#ffeaa0','#ffc939','#cf9310'], eye:['#ffd45e','#7d5806'], skin:'#fbdec6', lip:'#cd6673', style:'long',     accessory:'star',    outfit:['#4a3a16','#6b552a'], top:'offshoulder' },
  { id:'kurone', name:'Kurone',   hair:['#49584f','#1f2a25','#0b100e'], eye:['#9dff72','#26611d'], skin:'#f3d5c5', lip:'#b85a6c', style:'bob',      accessory:'choker',  outfit:['#121a16','#1f2e27'], top:'jacket' },
  { id:'mono',   name:'Null',     hair:['#f0f0f6','#bcbcca','#7a7a8c'], eye:['#c6c6d6','#33333f'], skin:'#f5e2d6', lip:'#c07084', style:'ponytail', accessory:'pin',     outfit:['#22222a','#34343f'], top:'collar' },
];

/* ── hair: back mass ──────────────────────────────────────── */
const BACK_HAIR = {
  long:`M200 48c-84 0-128 62-132 154-3 74-12 186-16 300-2 50 12 80 40 88l20-58c-16-104-10-206 4-280-16-76-6-150 84-174 90 24 100 98 84 174 14 74 20 176 4 280l20 58c28-8 42-38 40-88-4-114-13-226-16-300-4-92-48-154-132-154Z`,
  bob:`M200 50c-78 0-122 56-126 140-3 62-6 116-9 162 26 18 56 28 90 30-20-44-24-100-17-148-11-68 7-118 62-134 55 16 73 66 62 134 7 48 3 104-17 148 34-2 64-12 90-30-3-46-6-100-9-162-4-84-48-140-126-140Z`,
  hime:`M200 46c-88 0-132 68-134 166-2 100-6 240-9 360h58c-6-120-4-252 2-348-9-82 15-132 83-148 68 16 92 66 83 148 6 96 8 228 2 348h58c-3-120-7-260-9-360-2-98-46-166-134-166Z`,
  ponytail:[
    `M200 50c-78 0-122 58-126 148-3 64-8 128-12 176l56 10c2-54 6-108 10-156-9-68 13-114 72-130 59 16 81 62 72 130 4 48 8 102 10 156l56-10c-4-48-9-112-12-176-4-90-48-148-126-148Z`,
    `M302 142c40 20 62 66 66 124 6 72-8 150-34 216-11 28-31 48-54 52l-18-48c18-6 32-22 40-44 20-62 26-128 19-184-5-42-17-76-40-92Z`,
  ],
  twin:[
    `M200 50c-80 0-124 58-128 148-3 46-6 92-9 130l56 9c2-44 5-90 9-132-9-66 13-110 72-126 59 16 81 60 72 126 4 42 7 88 9 132l56-9c-3-38-6-84-9-130-4-90-48-148-128-148Z`,
    `M82 226c-30 18-46 60-48 118-2 62 8 128 26 182l56-16c-16-48-23-108-20-162 2-48 11-82 27-100Z`,
    `M318 226c30 18 46 60 48 118 2 62-8 128-26 182l-56-16c16-48 23-108 20-162-2-48-11-82-27-100Z`,
  ],
};

/** hair styles may be one shape or several — always work with a list,
 *  and keep them as separate <path> elements so winding cannot subtract */
const backHair = (style) => [BACK_HAIR[style]].flat();

/* ── hair: fringe ─────────────────────────────────────────────
   A dome over the forehead with a jagged lower edge. Tips stop
   at y≈184; the eyes' upper lash line is y≈189, so the fringe
   frames the eyes instead of cutting across them.
   ───────────────────────────────────────────────────────────── */
const BANGS = {
  long:`M136 196c-2-58 22-96 64-98 42 2 66 40 64 98-3-10-9-17-17-21l-6 12-9-14c-11 9-27 12-42 9l-8 10-9-13c-14 4-24 9-37 17Z`,
  bob:`M134 194c-2-56 24-94 66-96 42 2 66 38 64 96-3-11-10-19-18-23l-6 12-10-15c-11 8-26 11-41 8l-8 11-9-14c-14 5-26 11-38 21Z`,
  hime:`M134 200c-2-62 24-102 66-104 42 2 66 42 64 104-3-12-8-21-15-26l-7 14-10-17c-13 11-32 14-50 10l-8 12-10-15c-12 5-22 11-30 22Z`,
  ponytail:`M138 194c-2-54 22-92 62-94 40 2 64 38 62 94-3-9-8-16-16-19l-6 11-8-13c-10 8-25 10-39 7l-7 10-9-12c-13 4-25 10-39 16Z`,
  twin:`M136 196c-2-58 23-97 64-99 41 2 66 41 64 99-3-10-9-17-17-21l-6 12-10-14c-11 9-28 12-43 9l-7 10-9-13c-14 4-25 9-36 17Z`,
};

/* ── hair: face-framing strands, tapered ──────────────────── */
const LOCKS = {
  long:`M140 180c-11 90-9 172 5 238l17-9c-12-62-16-148-10-225Z M260 180c11 90 9 172-5 238l-17-9c12-62 16-148 10-225Z`,
  bob:`M137 178c-7 62-5 116 4 158l16-9c-8-38-12-104-7-147Z M263 178c7 62 5 116-4 158l-16-9c8-38 12-104 7-147Z`,
  hime:`M136 180c-10 100-8 194 5 276l21-11c-12-78-18-186-11-263Z M264 180c10 100 8 194-5 276l-21-11c12-78 18-186 11-263Z`,
  ponytail:`M141 180c-10 74-8 142 3 190l16-9c-9-45-13-126-7-179Z M259 180c10 74 8 142-3 190l-16-9c9-45 13-126 7-179Z`,
  twin:`M139 180c-10 76-8 146 3 196l16-9c-9-47-13-130-7-185Z M261 180c10 76 8 146-3 196l-16-9c9-47 13-130 7-185Z`,
};

/* ── tops ─────────────────────────────────────────────────── */
function top(kind, id) {
  const fit = `url(#fit-${id})`;
  switch (kind) {
    case 'offshoulder': return `
      <path d="M200 344c-20 0-36 8-44 22-46 14-76 46-86 96-8 40-12 94-14 158h288c-2-64-6-118-14-158-10-50-40-82-86-96-8-14-24-22-44-22Z" fill="${fit}"/>
      <path d="M156 366c12 26 26 40 44 40s32-14 44-40l-18-10c-8 14-15 20-26 20s-18-6-26-20Z" fill="url(#skin-${id})" opacity=".55"/>`;
    case 'jacket': return `
      <path d="M200 344c-22 0-38 8-46 24-48 14-78 46-88 98-8 40-12 92-14 154h296c-2-62-6-114-14-154-10-52-40-84-88-98-8-16-24-24-46-24Z" fill="${fit}"/>
      <path d="M176 352c6 30 14 52 24 66 10-14 18-36 24-66l-24-10Z" fill="#0d0f14" opacity=".45"/>
      <path d="M118 400c-10 34-14 80-16 138h30c0-62 4-108 12-134Z M282 400c10 34 14 80 16 138h-30c0-62-4-108-12-134Z" fill="#fff" opacity=".07"/>`;
    default: return `
      <path d="M200 344c-20 0-36 8-44 22-46 14-76 46-86 96-8 40-12 94-14 158h288c-2-64-6-118-14-158-10-50-40-82-86-96-8-14-24-22-44-22Z" fill="${fit}"/>
      <path d="M156 366 200 412l44-46 16 10-52 62-52-62Z" fill="#fff" opacity=".9"/>
      <path d="M200 412 186 440l14 18 14-18Z" fill="#c4485f"/>`;
  }
}

/* ── accessories ──────────────────────────────────────────── */
function accessory(kind, c) {
  const [A, , B] = c.hair, E = c.eye[0];
  switch (kind) {
    case 'blossom': return `
      <g transform="translate(272 150) rotate(16)">
        ${[0,72,144,216,288].map(a=>`<ellipse cx="0" cy="-15" rx="9" ry="16" fill="#fff3f8" stroke="#f7a2c9" stroke-width="1.8" transform="rotate(${a})"/>`).join('')}
        <circle r="6" fill="#ffd36b"/>
      </g>`;
    case 'phones': return `
      <path d="M104 196a96 96 0 0 1 192 0" fill="none" stroke="${B}" stroke-width="12" stroke-linecap="round"/>
      <rect x="84" y="182" width="32" height="54" rx="14" fill="${B}"/>
      <rect x="284" y="182" width="32" height="54" rx="14" fill="${B}"/>
      <rect x="91" y="194" width="18" height="30" rx="9" fill="${E}" opacity=".92"/>
      <rect x="291" y="194" width="18" height="30" rx="9" fill="${E}" opacity=".92"/>`;
    case 'flake': return `
      <g transform="translate(274 146)" stroke="#f0f7ff" stroke-width="3" stroke-linecap="round" fill="none">
        ${[0,60,120].map(a=>`<g transform="rotate(${a})"><path d="M-19 0h38"/><path d="M-12-6l-7 6 7 6"/><path d="M12-6l7 6-7 6"/></g>`).join('')}
        <circle r="4" fill="#f0f7ff" stroke="none"/>
      </g>`;
    case 'flame': return `
      <g transform="translate(276 150)">
        <path d="M0-24c11 11 17 21 17 30a17 17 0 0 1-34 0c0-9 6-19 17-30Z" fill="${A}"/>
        <path d="M0-10c5 6 8 11 8 16a8 8 0 0 1-16 0c0-5 3-10 8-16Z" fill="#fff6cf"/>
      </g>`;
    case 'ribbon': {
      const bow = (x, rot) => `
      <g transform="translate(${x} 174) rotate(${rot})">
        <path d="M0 0-26-15v30Z" fill="#fff5fa" stroke="${B}" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M0 0 26-15v30Z" fill="#fff5fa" stroke="${B}" stroke-width="2.5" stroke-linejoin="round"/>
        <circle r="7" fill="${B}"/>
      </g>`;
      return bow(104, -22) + bow(296, 22);
    }
    case 'moon': return `
      <g transform="translate(274 146)">
        <path d="M0-22a22 22 0 1 0 16 38A17 17 0 0 1 0-22Z" fill="#f6f0ff"/>
        <circle cx="20" cy="13" r="3" fill="#f6f0ff"/><circle cx="-22" cy="18" r="2.2" fill="#f6f0ff"/>
      </g>`;
    case 'star': return `
      <g transform="translate(276 144)">
        <path d="M0-22 6-6l17 2-12 12 3 17L0 16l-14 7 3-17-12-12 17-2Z" fill="#fff4c4" stroke="${B}" stroke-width="1.8"/>
      </g>`;
    case 'choker': return `
      <rect x="170" y="322" width="60" height="14" rx="7" fill="#0f0d0c"/>
      <circle cx="200" cy="329" r="6" fill="${E}"/>
      <path d="M200 336v14" stroke="#0f0d0c" stroke-width="2.5"/>
      <circle cx="200" cy="354" r="5" fill="${E}" opacity=".85"/>`;
    default: return `
      <g transform="translate(272 154) rotate(-14)">
        <rect x="-17" y="-4" width="34" height="9" rx="4.5" fill="${A}"/>
        <circle cx="-17" cy="0" r="6" fill="${B}"/>
      </g>`;
  }
}

/* ── one eye ──────────────────────────────────────────────── */
function eye(cx, cy, id, c, flip) {
  const lash = c.eye[1];
  return `<g transform="translate(${cx} ${cy}) scale(${flip ? -1 : 1} 1)">
  <path d="M-19-1c3-12 13-18 23-17 9 1 14 7 15 13 1 9-6 17-19 17S-21 6-19-1Z" fill="#fffcf9"/>
  <ellipse cx="-1" cy="-1" rx="11.5" ry="12.5" fill="url(#iris-${id})"/>
  <ellipse cx="-1" cy="-1" rx="11.5" ry="12.5" fill="url(#irisShade-${id})"/>
  <ellipse cx="-1" cy="0" rx="4.2" ry="5.6" fill="#16101c"/>
  <circle cx="-5.5" cy="-6" r="3.6" fill="#fff"/>
  <circle cx="4" cy="4" r="1.7" fill="#fff" opacity=".75"/>
  <path d="M-20-2c2-13 13-20 24-19 10 1 16 8 17 15" fill="none" stroke="${lash}" stroke-width="5.5" stroke-linecap="round"/>
  <path d="M-20-2c-4-2-8-2-11 0" fill="none" stroke="${lash}" stroke-width="4.4" stroke-linecap="round"/>
  <path d="M-15-10c4-6 12-9 20-8" fill="none" stroke="${lash}" stroke-width="2" stroke-linecap="round" opacity=".45"/>
  <path d="M-16 9c4 5 12 8 20 6" fill="none" stroke="${lash}" stroke-width="1.8" stroke-linecap="round" opacity=".4"/>
</g>`;
}

/* ── the portrait ─────────────────────────────────────────── */
function portrait(c) {
  const [h1, h2, h3] = c.hair;
  const [e1, e2] = c.eye;
  const [o1, o2] = c.outfit;
  const id = c.id;
  const FACE = 'M138 192c0-52 22-90 62-94 40 4 62 42 62 94 0 30-6 52-18 70-10 16-26 32-44 38-18-6-34-22-44-38-12-18-18-40-18-70Z';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 620" width="400" height="620" role="img" aria-label="${c.name}, the ${id} theme portrait">
<defs>
  <linearGradient id="hair-${id}" x1=".2" y1="0" x2=".8" y2="1">
    <stop offset="0" stop-color="${h1}"/><stop offset=".5" stop-color="${h2}"/><stop offset="1" stop-color="${h3}"/>
  </linearGradient>
  <linearGradient id="hairF-${id}" x1=".3" y1="0" x2=".7" y2="1">
    <stop offset="0" stop-color="${h1}"/><stop offset=".72" stop-color="${h2}"/><stop offset="1" stop-color="${h3}"/>
  </linearGradient>
  <linearGradient id="skin-${id}" x1=".4" y1="0" x2=".6" y2="1">
    <stop offset="0" stop-color="${lighten(c.skin, 5)}"/><stop offset=".62" stop-color="${c.skin}"/><stop offset="1" stop-color="${lighten(c.skin, -12)}"/>
  </linearGradient>
  <linearGradient id="fit-${id}" x1=".3" y1="0" x2=".7" y2="1">
    <stop offset="0" stop-color="${o2}"/><stop offset="1" stop-color="${o1}"/>
  </linearGradient>
  <radialGradient id="iris-${id}" cx=".5" cy=".28" r=".8">
    <stop offset="0" stop-color="${lighten(e1, 18)}"/><stop offset=".55" stop-color="${e1}"/><stop offset="1" stop-color="${e2}"/>
  </radialGradient>
  <linearGradient id="irisShade-${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#000" stop-opacity=".38"/><stop offset=".45" stop-color="#000" stop-opacity="0"/>
    <stop offset="1" stop-color="${lighten(e1, 30)}" stop-opacity=".5"/>
  </linearGradient>
  <radialGradient id="glow-${id}" cx=".5" cy=".4" r=".62">
    <stop offset="0" stop-color="${h1}" stop-opacity=".5"/><stop offset="1" stop-color="${h1}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="blush-${id}" cx=".5" cy=".5" r=".5">
    <stop offset="0" stop-color="${c.lip}" stop-opacity=".42"/><stop offset="1" stop-color="${c.lip}" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="face-${id}"><path d="${FACE}"/></clipPath>
  <clipPath id="hairClip-${id}">${backHair(c.style).map(d => `<path d="${d}"/>`).join('')}</clipPath>
</defs>

<ellipse cx="200" cy="300" rx="200" ry="262" fill="url(#glow-${id})"/>

<!-- hair, back -->
${backHair(c.style).map(d => `<path d="${d}" fill="url(#hair-${id})"/>`).join('\n')}
<g clip-path="url(#hairClip-${id})">
  <path d="M200 60c-70 8-104 60-108 140 26-58 58-88 108-92 50 4 82 34 108 92-4-80-38-132-108-140Z" fill="#fff" opacity=".1"/>
</g>

<!-- torso -->
${top(c.top, id)}

<!-- neck + collarbones -->
<path d="M182 292h36v42c0 14-8 22-18 22s-18-8-18-22Z" fill="url(#skin-${id})"/>
<path d="M182 292h36v16c-6 10-30 10-36 0Z" fill="${lighten(c.skin, -22)}" opacity=".7"/>
<path d="M174 372c10 5 18 7 26 7M226 372c-10 5-18 7-26 7" fill="none" stroke="${lighten(c.skin, -18)}" stroke-width="2.4" stroke-linecap="round" opacity=".5"/>

<!-- face -->
<path d="${FACE}" fill="url(#skin-${id})"/>
<g clip-path="url(#face-${id})">
  <ellipse cx="164" cy="242" rx="20" ry="11" fill="url(#blush-${id})"/>
  <ellipse cx="236" cy="242" rx="20" ry="11" fill="url(#blush-${id})"/>
  <path d="M138 150c14 30 24 48 24 74 0 22-8 40-20 56-8-24-10-56-4-130Z" fill="${lighten(c.skin,-14)}" opacity=".35"/>
  <path d="M262 150c-14 30-24 48-24 74 0 22 8 40 20 56 8-24 10-56 4-130Z" fill="${lighten(c.skin,-14)}" opacity=".35"/>
</g>

<!-- ears -->
<ellipse cx="143" cy="216" rx="7" ry="12" transform="rotate(-14 143 216)" fill="${lighten(c.skin,-10)}"/>
<ellipse cx="257" cy="216" rx="7" ry="12" transform="rotate(14 257 216)" fill="${lighten(c.skin,-10)}"/>

<!-- eyes -->
${eye(170, 208, id, c, false)}
${eye(230, 208, id, c, true)}

<!-- brows: thin, high, arched -->
<path d="M154 190c9-7 22-9 32-4" fill="none" stroke="${h3}" stroke-width="3" stroke-linecap="round" opacity=".62"/>
<path d="M246 190c-9-7-22-9-32-4" fill="none" stroke="${h3}" stroke-width="3" stroke-linecap="round" opacity=".62"/>

<!-- nose -->
<path d="M203 236c3 6 5 11 2 14" fill="none" stroke="${lighten(c.skin,-34)}" stroke-width="2.4" stroke-linecap="round" opacity=".65"/>

<!-- lips -->
<path d="M188 268c4-4 8-2 12 1 4-3 8-5 12-1 2 7-5 13-12 13s-14-6-12-13Z" fill="${c.lip}"/>
<path d="M192 270c4 2 12 2 16 0" fill="none" stroke="${lighten(c.lip,-18)}" stroke-width="1.5" stroke-linecap="round" opacity=".7"/>
<ellipse cx="197" cy="275" rx="4" ry="2" fill="#fff" opacity=".28"/>

<!-- hair, front -->
<path d="${LOCKS[c.style]}" fill="url(#hairF-${id})"/>
<path d="${BANGS[c.style]}" fill="url(#hairF-${id})"/>
<path d="M152 124c14-15 38-23 62-21-21 3-41 13-54 27Z" fill="#fff" opacity=".26"/>
<path d="M232 112c14 6 25 17 31 31-9-12-20-22-34-27Z" fill="#fff" opacity=".16"/>

${accessory(c.accessory, c)}
</svg>`;
}

/** shift a hex colour lighter (+) or darker (−) by a percentage */
function lighten(hex, pct) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v =>
    Math.max(0, Math.min(255, Math.round(v + 255 * (pct / 100)))));
  return '#' + ch.map(v => v.toString(16).padStart(2, '0')).join('');
}

mkdirSync(OUT, { recursive: true });
for (const c of CHARACTERS) {
  const svg = portrait(c);
  writeFileSync(resolve(OUT, `${c.id}.svg`), svg);
  console.log(`  ✓ images/themes/${c.id}.svg  (${c.name}, ${svg.length.toLocaleString()} bytes)`);
}
console.log(`\n${CHARACTERS.length} portraits written.`);
