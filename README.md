# 🎵 Heart Hacking Playlist

A premium hacker-themed music player. Matrix rain background, Spotify-style now-playing card, fully mobile-ready.

---

## ▶ How to Add Songs

### Method 1 — Local audio file (recommended)
1. Drop your `.mp3` into the `audio/` folder (e.g. `audio/mysong.mp3`)
2. Optionally drop a cover image with the **same base name** into `img/covers/`  
   (e.g. `img/covers/mysong.jpg` — supports `.jpg`, `.jpeg`, `.png`, `.webp`)
3. Add one entry to `songs.json`:

```json
{
  "title": "My Song",
  "artist": "Artist Name",
  "audio": "audio/mysong.mp3"
}
```
The player will auto-detect `img/covers/mysong.jpg` as the cover. No need to specify it.

### Method 2 — With explicit cover image
```json
{
  "title": "My Song",
  "artist": "Artist Name",
  "audio": "audio/mysong.mp3",
  "cover": "img/covers/mysong.jpg"
}
```

### Method 3 — External audio + online cover
```json
{
  "title": "My Song",
  "artist": "Artist Name",
  "audio": "https://example.com/song.mp3",
  "cover": "https://example.com/cover.jpg"
}
```

---

## ⌨ Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `Shift + →` | Next song |
| `Shift + ←` | Previous song |
| `→` | Seek +5 seconds |
| `←` | Seek -5 seconds |
| `↑` | Volume up |
| `↓` | Volume down |
| `L` | Toggle loop |
| `S` | Toggle shuffle |
| `M` | Mute / Unmute |
| `Escape` | Close now playing card |
| `N` | Next song |
| `P` | Previous song |

---

## 📱 Mobile Features
- Swipe down on the now-playing card to close it
- Lock screen / headphone controls via MediaSession API
- Touch-friendly 44px minimum button targets

---

## 📁 File Structure
```
player/
├── index.html          ← Main page (don't edit)
├── style.css           ← All styles (don't edit unless theming)
├── script.js           ← All logic (don't edit)
├── songs.json          ← ADD YOUR SONGS HERE
├── sw.js               ← Service worker (offline support)
├── audio/              ← Drop MP3 files here
│   └── mysong.mp3
├── img/
│   ├── covers/         ← Drop cover images here (same name as audio)
│   │   └── mysong.jpg
│   └── (ui icons)
└── README.md
```
