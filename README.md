<div align="center">

# AURA

**A private, offline-first music player.**
No account. No server. No telemetry. Your library, your device, your data.

`character-led themes` · `live visualisers` · `spatial audio` · `cross-device sync` · `PWA`

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
- **Character themes** whose entire palette is extracted from the artwork, in **light and dark**
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
| **Tab party** | Every open tab in one browser stays on the same second. |
| **Cross-device sync** | Playlists, favourites, marks, play counts and your exact position, shared between phone and laptop through a worker you host. Merges additively, so two devices editing offline both keep their changes. |
| **Vibe card** | Renders what's playing as a share-ready image: cover, waveform, play count. |
| **Listening DNA** | A radial fingerprint of your habits — one petal per track, length by time spent. |
| **Dream fade** | Sleep timer that eases the volume down over 30 seconds instead of cutting off mid-bar. |

---

## Where things live

```
audio/           your music + manifest.json (generated)
images/          cover art
  covers/        art extracted from ID3 tags by the builder
  chars/         character artwork, generated WebP + palettes.json
  themes/        overrides.json, if you point a theme elsewhere
css/             core · themes · components · anim
js/              main · player · engine · library · analysis
                 visualizer · themes · features · ui · views · store · db · util
tools/           build-manifest · serve · prep-art · gen-themes · gen-icons · aura-worker
sw.js            service worker (offline shell)
```

### Adding songs

**The easy way — straight from github.com, no tools, works from a phone:**

1. Open your repo → the **`audio/`** folder → **Add file → Upload files**
2. Drag your `.mp3`s in → **Commit changes**
3. Wait about a minute. That's it — refresh the player and they're there.

A workflow notices the upload, reads each file's ID3 tags for the title,
artist, album and year, pulls the embedded cover art out into
`images/covers/`, works out the duration from the MP3 frame headers, strips
download-site junk from the titles (`Tum Hi Ho - PagalSongs.com` →
`Tum Hi Ho`), and commits the updated `audio/manifest.json` back.

> **One-time setup for this to work:** Settings → Actions → General →
> Workflow permissions → **Read and write permissions** → Save. Without it
> the workflow can't commit the manifest back, and it will tell you so in the
> Actions log rather than failing quietly.

**From a computer, if you prefer:**

```bash
cp ~/Music/*.mp3 audio/
node tools/build-manifest.mjs
git add -A && git commit -m "add songs" && git push
```

**Just to listen right now, not to keep:** drag files onto the player window.
They play immediately and stay on that device — nothing is uploaded, and they
won't appear on your other devices.

### Adding cover images

Most of the time you don't have to — art embedded in the mp3 is extracted
automatically. When a track has none, cover art is found in this order:

1. artwork embedded in the file's ID3 tag → extracted to `images/covers/`
2. **an image in `images/` with the same filename as the audio**
3. a generated placeholder

So for `audio/husn.mp3`, upload `images/husn.jpg` and it is picked up. `.jpg`,
`.png`, `.webp` and `.gif` all work.

To point a track at any other image, edit `audio/manifest.json` directly:

```json
{ "title": "Husn", "src": "audio/husn.mp3", "cover": "images/anything.jpg" }
```

**Hand-edits stick.** Re-running the builder never overwrites a field you
changed — fix a title or swap the art and it stays. Delete a field to have it
detected again.

### Lyrics

Put a `.lrc` next to the audio file with the same name and it's picked up
automatically. Timestamped lines highlight as they play and are clickable to
seek. Plain-text lyrics work too, just without the sync.

### Themes

Five themes. Four are characters, and **every colour in the UI is read out of
their artwork** — accents, background tint, glow, the lot. Nothing is
hand-picked.

| id | who | palette source |
|---|---|---|
| `aoi` | Aoi — ribbon blue | her ribbons and eyes |
| `nyx` | Nyx — midnight cat | bedding and lamplight |
| `mizu` | Mizu — shoreline | sea, eyes, sand |
| `kaede` | Kaede — hot spring | hair, night sky, water |
| `mono` | Null | no artwork at all |

Each character is the full-bleed backdrop: anchored right on a desktop with
the home screen's content stopping short to give her a column, and across the
top of a phone with the copy laid over her. Away from home she drops back so
lists stay readable. A 20px blurred placeholder is inlined in the registry, so
she is on screen before the real image has decoded.

### Adding or changing a character

```bash
cp ~/art/rin.png images/chars/rin-src.png     # any size, any format
# add a row to CHARACTERS in tools/gen-themes.mjs
npm run art
```

That one command:

- resizes to a 1400px backdrop and a 700px card, encodes both as WebP
  (~80% smaller than the source)
- inlines a 20px blurred placeholder
- reads a palette out of the image — squaring saturation so vivid colour beats
  large flat areas, and discounting the warm neutrals (skin, brown hair, sand)
  that dominate character art by area but lift into the same washed-out beige
- writes `css/chars.css` and `js/characters.js`

If area-ranking picks the wrong thing — backgrounds often beat the character —
add the character to `PREFER` in `tools/prep-art.mjs` with the hues worth
leading on. It still reads the real colour out of the artwork, it just knows
where to look.

**Or skip all of it:** tap **+** on any theme card in the app to use your own
image on that device only. Nothing is uploaded, and it works from a phone.

> Only use art you have the right to use. Nothing generated here is copied
> from anywhere; anything you add is yours to clear.

---

## Syncing across devices

Out of the box everything is local to one browser. **Tab party** (in the Lab)
syncs tabs on one device via `BroadcastChannel` — it cannot cross devices,
because nothing in a static site can.

For real phone-to-laptop sync, deploy `tools/aura-worker.js` to a free
Cloudflare Worker — setup steps are in the file's header, about three minutes —
then fill in **Settings → Sync across devices**:

| | |
|---|---|
| **Endpoint** | your worker URL |
| **Room key** | any long private string, *identical* on every device |

The room key is the only credential. Anyone who knows it can read and write
your data, so treat it like a password.

**What syncs:** playlists, favourites, moment marks, play counts, theme, EQ,
and the track + position you were on.
**What doesn't:** your audio. Each device plays from its own `audio/` folder,
so serve the same library (GitHub Pages does that for you) and everything
lines up.

Merging is additive — favourites and marks union, play counts take the higher
side, playlists resolve by timestamp — so a device that was offline never
silently wipes the other's changes.

By default the other device *offers* to hand over ("continue from here")
rather than seizing playback. Turn on **Live Follow** to have it track
continuously instead; that polls, so expect a second or two of drift.
Sample-accurate lockstep would need a WebSocket, which a KV-backed worker
isn't.

The same worker also powers the **listener count** — one endpoint covers both.
Without it, the count falls back to open tabs on your own device, which is
honest but local.

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
one yourself, your own sync worker.

Library metadata, playlists, favourites, marks and statistics live in
`localStorage`. Imported audio and cached waveforms live in IndexedDB. Export
all of it from **Settings → Your data**, or wipe it from the same place.

---

## Licence

MIT for the code. Your music is your own — nothing here uploads or
redistributes it.
