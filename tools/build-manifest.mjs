#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   Scans audio/ and writes audio/manifest.json — the list AURA
   reads on startup.

     node tools/build-manifest.mjs
     node tools/build-manifest.mjs --no-art     (skip cover extraction)

   For each file it works out, in order of preference:
     title/artist/album  ID3v2 tag  →  tidied filename
     cover art           ID3 APIC   →  images/<basename>.*  →  none
     duration            MP3 frame headers (CBR + Xing/VBR), MP4 mvhd
   Existing entries keep any field you edited by hand, and entries
   whose src is an http(s) URL are carried through untouched, so you
   can re-run this safely after adding files.
   ═══════════════════════════════════════════════════════════ */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname, basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO_DIR = resolve(ROOT, 'audio');
const IMAGE_DIR = resolve(ROOT, 'images');
const COVER_DIR = resolve(IMAGE_DIR, 'covers');
const OUT = resolve(AUDIO_DIR, 'manifest.json');

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac', '.webm']);
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const noArt = process.argv.includes('--no-art');

/* ═══════════════════════════════════════════════════════════
   ID3v2 reader (Node-side twin of js/library.js)
   ═══════════════════════════════════════════════════════════ */
function readID3(buf) {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return {};
  const major = buf[3];
  const size = synchsafe(buf[6], buf[7], buf[8], buf[9]);
  const end = Math.min(buf.length, 10 + size);

  const out = {};
  const idLen = major === 2 ? 3 : 4;
  let p = 10;

  while (p + idLen + (major === 2 ? 3 : 6) <= end) {
    const id = buf.toString('latin1', p, p + idLen);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    p += idLen;

    let frameSize;
    if (major === 2) { frameSize = buf.readUIntBE(p, 3); p += 3; }
    else if (major === 4) { frameSize = synchsafe(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]); p += 6; }
    else { frameSize = buf.readUInt32BE(p); p += 6; }

    if (frameSize <= 0 || p + frameSize > end) break;
    const body = buf.subarray(p, p + frameSize);
    p += frameSize;

    switch (id) {
      case 'TIT2': case 'TT2': out.title = scrub(text(body)); break;
      case 'TPE1': case 'TP1': out.artist = scrub(text(body)); break;
      case 'TALB': case 'TAL': out.album = scrub(text(body)); break;
      case 'TCON': case 'TCO': out.genre = scrub(genre(text(body))); break;
      case 'TYER': case 'TYE': case 'TDRC': out.year = parseInt(text(body).slice(0, 4), 10) || null; break;
      case 'APIC': case 'PIC': if (!out.picture) out.picture = picture(body, major); break;
    }
  }
  return out;
}

const synchsafe = (a, b, c, d) => (a << 21) | (b << 14) | (c << 7) | d;

function text(body) {
  if (!body.length) return '';
  const enc = body[0], data = body.subarray(1);
  let s;
  if (enc === 1) {
    if (data[0] === 0xFF && data[1] === 0xFE) s = data.subarray(2).toString('utf16le');
    else if (data[0] === 0xFE && data[1] === 0xFF) s = swap16(data.subarray(2)).toString('utf16le');
    else s = data.toString('utf16le');
  } else if (enc === 2) s = swap16(data).toString('utf16le');
  else if (enc === 3) s = data.toString('utf8');
  else s = data.toString('latin1');
  return s.replace(/\0+$/, '').trim();
}
function swap16(b) { const c = Buffer.from(b); c.swap16(); return c; }

function picture(body, major) {
  try {
    let at = 1, mime;
    if (major === 2) { mime = 'image/' + body.toString('latin1', 1, 4).toLowerCase().replace('jpg', 'jpeg'); at = 4; }
    else {
      let e = at; while (e < body.length && body[e] !== 0) e++;
      mime = body.toString('latin1', at, e) || 'image/jpeg';
      at = e + 1;
    }
    at += 1;                                     // picture type byte
    while (at < body.length && body[at] !== 0) at++;   // description
    at += 1;
    const data = body.subarray(at);
    return data.length > 512 ? { mime, data } : null;
  } catch { return null; }
}

const ID3_GENRES = ['Blues','Classic Rock','Country','Dance','Disco','Funk','Grunge','Hip-Hop','Jazz','Metal','New Age','Oldies','Other','Pop','R&B','Rap','Reggae','Rock','Techno','Industrial','Alternative','Ska','Death Metal','Pranks','Soundtrack','Euro-Techno','Ambient','Trip-Hop','Vocal','Jazz+Funk','Fusion','Trance','Classical','Instrumental','Acid','House','Game','Sound Clip','Gospel','Noise','Alt. Rock','Bass','Soul','Punk','Space','Meditative','Instrumental Pop','Instrumental Rock','Ethnic','Gothic','Darkwave','Techno-Industrial','Electronic','Pop-Folk','Eurodance','Dream','Southern Rock','Comedy','Cult','Gangsta Rap','Top 40','Christian Rap','Pop/Funk','Jungle','Native American','Cabaret','New Wave','Psychedelic','Rave','Showtunes','Trailer','Lo-Fi','Tribal','Acid Punk','Acid Jazz','Polka','Retro','Musical','Rock & Roll','Hard Rock'];
function genre(raw) {
  if (!raw) return '';
  const m = raw.match(/^\((\d+)\)/);
  if (m) return ID3_GENRES[+m[1]] || raw.replace(/^\(\d+\)/, '').trim();
  if (/^\d+$/.test(raw)) return ID3_GENRES[+raw] || raw;
  return raw;
}

/* ═══════════════════════════════════════════════════════════
   MP3 duration — Xing/VBRI frame count, else CBR arithmetic
   ═══════════════════════════════════════════════════════════ */
const BITRATES = {
  // [version][layer] → table indexed by the 4-bit bitrate field
  'mpeg1-3': [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0],
  'mpeg2-3': [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0],
};
const SAMPLE_RATES = { 3: [44100,48000,32000], 2: [22050,24000,16000], 0: [11025,12000,8000] };

/* ── MP4 / M4A duration ───────────────────────────────────────
   mp3Duration only understands MPEG frame headers, so an .m4a used to
   land in the manifest with duration 0 and show as 0:00 until you played
   it. The length is sitting in the mvhd atom: walk the box tree down
   moov → mvhd and read timescale + duration out of it. */
function mp4Duration(buf) {
  const atEnd = buf.length;

  function walk(start, end, want) {
    let p = start;
    while (p + 8 <= end) {
      let size = buf.readUInt32BE(p);
      const type = buf.toString('latin1', p + 4, p + 8);
      let head = 8;
      if (size === 1) {                       // 64-bit extended size
        if (p + 16 > end) return null;
        const hi = buf.readUInt32BE(p + 8);
        size = hi * 2 ** 32 + buf.readUInt32BE(p + 12);
        head = 16;
      } else if (size === 0) {
        size = end - p;                       // runs to the end of the file
      }
      if (size < head || p + size > end) return null;
      if (type === want) return { body: p + head, end: p + size };
      p += size;
    }
    return null;
  }

  const moov = walk(0, atEnd, 'moov');
  if (!moov) return 0;
  const mvhd = walk(moov.body, moov.end, 'mvhd');
  if (!mvhd) return 0;

  const b = mvhd.body;
  const version = buf[b];
  let timescale, units;
  if (version === 1) {
    if (b + 28 > mvhd.end) return 0;
    timescale = buf.readUInt32BE(b + 20);
    units = Number(buf.readBigUInt64BE(b + 24));
  } else {
    if (b + 20 > mvhd.end) return 0;
    timescale = buf.readUInt32BE(b + 12);
    units = buf.readUInt32BE(b + 16);
  }
  if (!timescale || !units) return 0;
  return Math.round((units / timescale) * 10) / 10;
}

function mp3Duration(buf) {
  let at = 0;
  if (buf.toString('latin1', 0, 3) === 'ID3') at = 10 + synchsafe(buf[6], buf[7], buf[8], buf[9]);

  // find the first frame sync within a reasonable window
  const limit = Math.min(buf.length - 4, at + 200000);
  while (at < limit) {
    if (buf[at] === 0xFF && (buf[at + 1] & 0xE0) === 0xE0) {
      const frame = parseFrame(buf, at);
      if (frame) return durationFrom(buf, at, frame);
    }
    at++;
  }
  return 0;
}

function parseFrame(buf, at) {
  const b1 = buf[at + 1], b2 = buf[at + 2], b3 = buf[at + 3];
  const versionBits = (b1 >> 3) & 3;       // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const layerBits = (b1 >> 1) & 3;         // 1 = Layer III
  if (versionBits === 1 || layerBits !== 1) return null;

  const bitrateIdx = (b2 >> 4) & 15;
  const rateIdx = (b2 >> 2) & 3;
  if (bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) return null;

  const table = versionBits === 3 ? BITRATES['mpeg1-3'] : BITRATES['mpeg2-3'];
  const bitrate = table[bitrateIdx] * 1000;
  const sampleRate = SAMPLE_RATES[versionBits]?.[rateIdx];
  if (!bitrate || !sampleRate) return null;

  const padding = (b2 >> 1) & 1;
  const samplesPerFrame = versionBits === 3 ? 1152 : 576;
  const frameLen = Math.floor(samplesPerFrame / 8 * bitrate / sampleRate) + padding;
  const channelMode = (b3 >> 6) & 3;       // 3 = mono

  return { bitrate, sampleRate, samplesPerFrame, frameLen, mono: channelMode === 3, mpeg1: versionBits === 3 };
}

function durationFrom(buf, at, f) {
  // Xing / Info header sits after the side information
  const sideInfo = f.mpeg1 ? (f.mono ? 17 : 32) : (f.mono ? 9 : 17);
  const tagAt = at + 4 + sideInfo;
  const tag = buf.toString('latin1', tagAt, tagAt + 4);

  if (tag === 'Xing' || tag === 'Info') {
    const flags = buf.readUInt32BE(tagAt + 4);
    if (flags & 1) {
      const frames = buf.readUInt32BE(tagAt + 8);
      if (frames > 0) return round(frames * f.samplesPerFrame / f.sampleRate);
    }
  }
  if (buf.toString('latin1', at + 4 + 32, at + 4 + 36) === 'VBRI') {
    const frames = buf.readUInt32BE(at + 4 + 32 + 14);
    if (frames > 0) return round(frames * f.samplesPerFrame / f.sampleRate);
  }
  // constant bitrate: audio bytes ÷ byte rate
  return round((buf.length - at) * 8 / f.bitrate);
}

const round = (s) => Math.round(s * 10) / 10;

/* ═══════════════════════════════════════════════════════════
   Scrub the junk that download sites staple onto tags:
   "Tum Hi Ho - PagalSongs.com"  →  "Tum Hi Ho"
   ═══════════════════════════════════════════════════════════ */
const SPAM_SITES = /(?:www\.)?[a-z0-9-]*(?:pagal|songspk|songs\.pk|mrjatt|mr-jatt|djpunjab|djmaza|masstamilan|webmusic|wapking|downloadming|bestwap|pendujatt|raagsong|freshmaza|mp3juice|y2mate|ytmp3|savefrom|tubidy|naasongs|starmusiq|isaimini|likewap|pagalworld|djjohal|riskyjatt)[a-z0-9-]*(?:\.(?:com|in|net|co|org|me|info|link|site|fun|wap))?/i;

function scrub(value) {
  if (!value) return '';
  let s = String(value);

  // bracketed or dash-separated spam chunks
  s = s.replace(/[([{][^)\]}]*[)\]}]/g, (chunk) => SPAM_SITES.test(chunk) ? '' : chunk);
  s = s.split(/\s*[-–—|]\s*/).filter(part => !SPAM_SITES.test(part) || part.length > 34).join(' - ');

  // bitrate stamps and leftover bare domains
  s = s.replace(/\b(?:128|192|256|320)\s*k?bps\b/gi, '');
  s = s.replace(new RegExp(SPAM_SITES.source, 'gi'), '');
  s = s.replace(/\b[a-z0-9-]+\.(?:com|in|net|co|org|me|info)\b/gi, '');

  return s.replace(/\s*[-–—|_]+\s*$/, '').replace(/^\s*[-–—|_]+\s*/, '').replace(/\s{2,}/g, ' ').trim();
}

/* ── naming helpers ───────────────────────────────────────── */
function prettify(name) {
  return name
    .replace(/[_]+/g, ' ')
    .replace(/^\s*\d{1,3}\s*[-.)]\s*/, '')     // leading track numbers
    .replace(/\s*[-–]\s*/g, ' – ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}
function cleanTitle(v, fallback) {
  const s = scrub(v);
  return s || fallback;
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cover';

function main() {
  /* ── existing manifest: preserve hand-edits ───────────────── */
  let previous = [];
  if (existsSync(OUT)) {
    try {
      const raw = JSON.parse(readFileSync(OUT, 'utf8'));
      previous = Array.isArray(raw) ? raw : (raw.tracks || []);
    } catch { console.warn('! existing manifest.json is not valid JSON — starting fresh'); }
  }
  const prevBySrc = new Map(previous.map(t => [t.src || t.audio, t]));

  /* ── walk audio/ ──────────────────────────────────────────── */
  if (!existsSync(AUDIO_DIR)) {
    console.error(`No audio/ folder at ${AUDIO_DIR}. Create it and drop your music in.`);
    process.exit(1);
  }

  const files = readdirSync(AUDIO_DIR)
    .filter(f => AUDIO_EXT.has(extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const streamed = previous.filter(t => /^https?:\/\//i.test(t.src || t.audio || ''));

  if (!files.length) {
    console.log(streamed.length
      ? `No audio files in audio/ — keeping ${streamed.length} streaming entr${streamed.length === 1 ? 'y' : 'ies'}.`
      : 'No audio files in audio/ — nothing to do.');
    writeFileSync(OUT, JSON.stringify(streamed, null, 2) + '\n');
    process.exit(0);
  }

  if (!noArt) mkdirSync(COVER_DIR, { recursive: true });

  const imagePool = existsSync(IMAGE_DIR)
    ? readdirSync(IMAGE_DIR).filter(f => IMAGE_EXT.includes(extname(f).toLowerCase()))
    : [];

  const tracks = [];
  let withTags = 0, withArt = 0, withDuration = 0;

  for (const file of files) {
    const full = join(AUDIO_DIR, file);
    const src = `audio/${file}`;
    const base = basename(file, extname(file));
    const buf = readFileSync(full);

    const tags = extname(file).toLowerCase() === '.mp3' ? readID3(buf) : {};
    if (tags.title || tags.artist) withTags++;

    /* cover: embedded art first, then a matching image, then the previous value */
    let cover = '';
    if (!noArt && tags.picture) {
      const ext = tags.picture.mime.includes('png') ? '.png' : '.jpg';
      const out = `images/covers/${slug(base)}${ext}`;
      writeFileSync(resolve(ROOT, out), tags.picture.data);
      cover = out;
      withArt++;
    }
    if (!cover) {
      const match = imagePool.find(f => basename(f, extname(f)).toLowerCase() === base.toLowerCase());
      if (match) cover = `images/${match}`;
    }

    const ext = extname(file).toLowerCase();
    const duration = ext === '.mp3' ? mp3Duration(buf)
                   : (ext === '.m4a' || ext === '.aac' || ext === '.mp4') ? mp4Duration(buf)
                   : 0;
    if (duration) withDuration++;

    const prev = prevBySrc.get(src) || {};
    const lrc = existsSync(join(AUDIO_DIR, base + '.lrc')) ? `audio/${base}.lrc` : (prev.lrc || null);

    tracks.push({
      title:    scrub(prev.title) || tags.title  || prettify(base),
      artist:   prev.artist || tags.artist || 'Unknown artist',
      album:    prev.album  ?? (tags.album || ''),
      src,
      cover:    prev.cover  || cover || '',
      genre:    prev.genre  || (tags.genre ? [tags.genre] : []),
      year:     prev.year   ?? (tags.year || null),
      duration: duration || prev.duration || 0,
      ...(lrc ? { lrc } : {}),
    });
  }

  /* A track whose src is a URL has no file here to scan — it streams from
     wherever it lives. Carry those through untouched, or every re-run of
     this script would quietly delete them. */
  tracks.push(...streamed);

  writeFileSync(OUT, JSON.stringify(tracks, null, 2) + '\n');

  const totalSec = tracks.reduce((a, t) => a + (t.duration || 0), 0);
  console.log(`\n  ${tracks.length} track${tracks.length === 1 ? '' : 's'} → audio/manifest.json`);
  console.log(`  ${withTags} with ID3 tags · ${withArt} covers extracted · ${withDuration} durations read`);
  if (streamed.length) console.log(`  ${streamed.length} streaming from a remote URL (kept as-is)`);
  if (totalSec) console.log(`  total runtime ${Math.floor(totalSec / 60)}m ${Math.round(totalSec % 60)}s`);
  const missingArt = tracks.filter(t => !t.cover).length;
  if (missingArt) console.log(`  ${missingArt} without cover art — drop images/<filename>.jpg to match by name`);
  console.log('');
}

main();
