<div align="center">

# AURA

**A private, offline-first music player.**
No account. No server. No telemetry. Your library, your device, your data.

`glassmorphism` · `live visualisers` · `spatial audio` · `9 anime themes` · `PWA`

</div>

---

## What this is

A single-page music player that runs entirely in the browser. Point it at a
folder of audio files and it gives you a full library — artwork, tags, search,
playlists, an equalizer, synced lyrics, six visualisers and a pile of things
most players don't have.

Everything is vanilla: **no framework, no bundler, no build step, zero runtime
dependencies.** Clone it and it runs.

---

## Quick start

```bash
# 1 — put your music in audio/  and any cover art in images/
cp ~/Music/*.mp3 audio/

# 2 — build the library index (reads ID3 tags, extracts embedded art)
node tools/build-manifest.mjs

# 3 — serve it (ES modules need a real origin; file:// will not work)
node tools/serve.mjs
#    → http://localhost:8080
```

That's it. No `npm install`.

**Don't want to run the builder?** Just drag audio files onto the window.
They're read locally, tags and all, and stay on your device.

---

## Features

### Playback
- Gapless playback with a pre-buffered second deck
- **Crossfade** up to 12s, with proper gain ramps between two decks
- 10-band equalizer + 10 presets, plus an independent bass shelf
- Playback speed 0.5×–2× with pitch preserved
- Volume levelling, shuffle, repeat off/all/one
- Media Session integration — lock screen and headphone controls
- Queue with drag-to-reorder, play-next, save-as-playlist

### Library
- Reads **ID3v2.2/2.3/2.4** tags directly: title, artist, album, year, genre, embedded cover art, embedded lyrics
- Group by artist / album / genre; sort five ways; fuzzy search across every field
- Virtualised list — a 5,000-track library scrolls at 60fps on a phone
- Playlists, favourites, recently-played, most-played
- Drag-and-drop import, folder picker, `.lrc` sidecar lyrics

### Look
- **9 themes**, each an anime-styled character with a full palette, in **light and dark**
- **4 surface styles**: Glass, Aurora, Neumorph, Flat
- **Accent from cover art** — the whole UI recolours from whatever is playing
- 6 visualisers: Spectrum, Ribbon, Radial, Starfield, Aurora, Terrain
- Beat-reactive UI pulse, ambient aurora background, lazy-loaded artwork
- Works from 320px to ultrawide; respects `prefers-reduced-motion`

### Things other players don't have

| | |
|---|---|
| **Echo map** | The player counts which seconds you actually replay and paints them as heat behind the waveform. Your hot loops, made visible. |
| **Moment marks** | Pin the exact second of a drop, a lyric, a laugh. Jump straight back, or loop between two marks. |
| **Orbit** | Sends the track circling your head through an HRTF panner driven by two quadrature LFOs. Real 8D, not a preset. |
| **Vocal isolate** | Mid/side re-encoding cancels the centre channel — instant karaoke, on a slider so you can just *dip* the vocal. |
| **Mood DJ** | Scores every track's energy from the decoded audio, then orders a set along a curve you pick: warm up → peak → land softly. |
| **Tab party** | Every open tab on the device stays on the same track and the same second. Control it from any of them. |
| **Vibe card** | Renders what's playing as a share-ready image: cover, waveform, play count. |
| **Listening DNA** | A radial fingerprint of your habits — one petal per track, length by time spent. |
| **Dream fade** | Sleep timer that eases the volume down over 30 seconds instead of cutting off mid-bar. |

---

## Where things live

```
audio/           your music + manifest.json (generated)
images/          cover art
  covers/        art extracted from ID3 tags by the builder
  themes/        the 9 character portraits (SVG) + overrides.json
css/             core · themes · components · anim
js/              main · player · engine · library · analysis
                 visualizer · themes · features · ui · views · store · db · util
tools/           build-manifest · serve · gen-portraits · gen-icons · presence-worker
sw.js            service worker (offline shell)
```

### Adding music

Drop files in `audio/` and re-run the builder:

```bash
node tools/build-manifest.mjs
```

It reads ID3 tags, extracts embedded cover art into `images/covers/`, works out
MP3 durations from frame headers (CBR and Xing/VBR), and strips the junk that
download sites staple onto tags (`Tum Hi Ho - PagalSongs.com` → `Tum Hi Ho`).

**Re-running is safe.** Anything you hand-edited in `audio/manifest.json` is
preserved. Delete a field to have it re-detected.

Cover art is matched in this order: embedded tag → `images/<same-filename>.jpg`
→ nothing.

### Lyrics

Put a `.lrc` next to the audio file with the same name and it's picked up
automatically. Timestamped lines highlight as they play and are clickable to
seek. Plain-text lyrics work too, just without the sync.

### Themes

Nine palettes, each with an original character portrait:

| id | theme | who |
|---|---|---|
| `sakura` | Sakura Drift | Sakura — petals & dusk |
| `neon` | Cyber Rin | Rin — rain-slick neon |
| `yuki` | Midnight Yuki | Yuki — snowfall & silver |
| `ember` | Ember Hana | Hana — forge-light |
| `mint` | Aoi Mint | Aoi — sea glass |
| `violet` | Violet Nocturne | Nocturne — velvet & moonlight |
| `hikari` | Solar Hikari | Hikari — dawn & gold leaf |
| `kurone` | Abyss Kurone | Kurone — void & toxic bloom |
| `mono` | Monochrome | Null — no distractions |

The portraits are original SVGs generated by `tools/gen-portraits.mjs` —
nothing downloaded, nothing copied, so the repo stays legally clean.

**To use your own art** (your actual waifu images), either overwrite
`images/themes/<id>.svg`, or map an id to any file in
`images/themes/overrides.json`:

```json
{ "sakura": "images/my-art/sakura.png" }
```

**To add a theme**, copy a block in `css/themes.css`, change the four hues, and
add an entry to `THEMES` in `js/themes.js`.

---

## The listener count

The pill in the sidebar shows how many people are listening. Out of the box it
counts **open tabs on your own device** — honest, instant, no backend.

For a **real global count**, deploy `tools/presence-worker.js` to a free
Cloudflare Worker (setup instructions are in the file's header) and paste the
URL into **Settings → Listener count → Presence endpoint**.

Any endpoint works, as long as `GET` returns CORS-enabled JSON:

```json
{ "online": 12, "total": 480 }
```

The worker stores a random per-browser id and a timestamp. No IP, no user
agent, no listening history.

---

## Keyboard

| | | | |
|---|---|---|---|
| `Space` `K` | play / pause | `F` | favourite |
| `J` `L` | ∓10 seconds | `M` | drop a moment mark |
| `← →` | ∓5 seconds | `E` | full-screen player |
| `⇧ ← →` | prev / next track | `V` | cycle visualiser |
| `↑ ↓` | volume | `T` | theme picker |
| `⇧ M` | mute | `/` | search |
| `S` | shuffle | `1`–`7` | jump to a section |
| `R` | repeat | `⇧ 0`–`9` | seek to 0–90% |
| `?` | shortcuts | `Esc` | close anything open |

On touch: swipe the mini-player left/right to change track, swipe the
full-screen player down to dismiss, long-press any row for its menu.

---

## Deploying

It's a static site — anything that serves files will do.

**GitHub Pages** is already wired up: push to the default branch and the
included workflow publishes it. Settings → Pages → Source → GitHub Actions.

**Anywhere else**: upload the whole folder. No build step.

A note on large libraries: audio files count against Git's storage. If you have
gigabytes of music, keep `audio/` out of the repo (add it to `.gitignore`) and
sync it separately, or rely on drag-and-drop import.

---

## Browser support

| | Chrome / Edge | Firefox | Safari |
|---|---|---|---|
| Playback, EQ, visualisers | ✅ | ✅ | ✅ |
| Orbit (HRTF spatial) | ✅ | ✅ | ✅ |
| Vocal isolate | ✅ | ✅ | ✅ |
| Offline / installable | ✅ | ✅ | ✅ |
| Folder picker | ✅ | — | — |
| Share sheet (vibe card) | ✅ | — | ✅ |

Where something is missing the app falls back rather than breaking — the folder
picker becomes a file picker, the share sheet becomes a download.

---

## Privacy

Nothing leaves your device. There is no analytics, no account, no sync, no
network call other than the files you're playing — plus Google Fonts for the
typeface (it falls back to system fonts if blocked) and, only if you configure
one yourself, the presence endpoint.

Library metadata, playlists, favourites, marks and statistics live in
`localStorage`. Imported audio and cached waveforms live in IndexedDB. Export
all of it from **Settings → Your data**, or wipe it from the same place.

---

## Licence

MIT for the code. Your music is your own — nothing here uploads or
redistributes it.
