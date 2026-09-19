# audio/

Put your music here, then run:

```bash
node tools/build-manifest.mjs
```

That writes `manifest.json` — the list AURA reads on startup.

### Supported
`.mp3` `.m4a` `.aac` `.ogg` `.opus` `.wav` `.flac` `.webm`

Durations are read from MP3 frame headers (CBR and Xing/VBR). Other formats
get their duration from the browser the first time you play them.

### Lyrics
Put a `.lrc` next to a track with the same basename:

```
audio/husn.mp3
audio/husn.lrc
```

Timestamped lines (`[01:23.45] text`) highlight as they play and are clickable
to seek. Plain text works too, just unsynced.

### Cover art
Priority order:
1. artwork embedded in the file's ID3 tag (extracted to `images/covers/`)
2. `images/<same-basename>.jpg` (or `.png`, `.webp`)
3. a generated placeholder

### Editing by hand
`manifest.json` is plain JSON and the builder never overwrites what you've
changed. Fix a title, add a genre, point at different art — it sticks. Delete a
field to have it re-detected on the next run.

### Big libraries
Audio files count against Git storage. If `audio/` is getting large, add it to
`.gitignore` and keep your music outside the repo — or skip the manifest
entirely and drag files onto the window, which never touches disk.
