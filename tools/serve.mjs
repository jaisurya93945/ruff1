#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   A dependency-free static server for local development.
   ES modules need a real origin, so opening index.html from
   the filesystem will not work — run this instead:

     node tools/serve.mjs            → http://localhost:8080
     node tools/serve.mjs 3000       → a different port

   Supports HTTP range requests, so seeking in long tracks
   behaves exactly as it will in production.
   ═══════════════════════════════════════════════════════════ */
import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { resolve, join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = parseInt(process.argv[2], 10) || parseInt(process.env.PORT, 10) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg',
  '.wav': 'audio/wav', '.flac': 'audio/flac', '.webm': 'audio/webm',
  '.lrc': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400).end('Bad request'); return; }

  if (pathname === '/') pathname = '/index.html';

  // keep everything inside ROOT
  const target = normalize(join(ROOT, pathname));
  if (!target.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

  if (!existsSync(target) || statSync(target).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }

  const stat = statSync(target);
  const type = TYPES[extname(target).toLowerCase()] || 'application/octet-stream';
  const headers = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'no-cache',
    // the visualiser needs same-origin audio; these keep SharedArrayBuffer-ish
    // features happy without breaking anything else
    'access-control-allow-origin': '*',
  };

  const range = req.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
      if (start >= stat.size || end >= stat.size || start > end) {
        res.writeHead(416, { 'content-range': `bytes */${stat.size}` }).end();
        return;
      }
      res.writeHead(206, {
        ...headers,
        'content-range': `bytes ${start}-${end}/${stat.size}`,
        'content-length': end - start + 1,
      });
      createReadStream(target, { start, end }).pipe(res);
      return;
    }
  }

  res.writeHead(200, { ...headers, 'content-length': stat.size });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(target).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n  AURA is serving on  http://localhost:${PORT}\n`);
  console.log(`  root   ${ROOT}`);
  console.log(`  stop   Ctrl-C\n`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`\n  Port ${PORT} is busy. Try:  node tools/serve.mjs ${PORT + 1}\n`);
  else console.error(err);
  process.exit(1);
});
