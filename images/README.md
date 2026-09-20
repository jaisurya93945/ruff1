# images/

| | |
|---|---|
| `covers/` | artwork the manifest builder pulled out of ID3 tags |
| `themes/` | the nine character portraits, one SVG per theme |
| `icon-*.png` | PWA icons (regenerate with `node tools/gen-icons.mjs`) |
| anything else | free to use as cover art — see below |

### Cover art by filename

Name an image after an audio file and it's picked up automatically:

```
audio/husn.mp3   →   images/husn.jpg
```

Embedded ID3 artwork wins over this; a filename match is the fallback.

### Character artwork

`chars/` holds the themes. For each character:

| file | what |
|---|---|
| `<id>-src.png` | your original, any size |
| `<id>.webp` | generated full-bleed backdrop |
| `<id>-card.webp` | generated theme-picker portrait |
| `palettes.json` | generated palettes + blurred placeholders |

Only `-src` files are yours to edit. Everything else is rebuilt by
`npm run art`, so do not hand-edit it.

**Add one:** drop `images/chars/<id>-src.png`, add a row to `CHARACTERS` in
`tools/gen-themes.mjs`, run `npm run art`.

Portraits work best tall (2:3 or 3:4) with the subject's head in the upper
third — the backdrop anchors bottom-right on a desktop and crops from the top
on a phone.

### Using a different image for one theme

Either overwrite that character's `-src` file and re-run `npm run art`, or
point at any path in `themes/overrides.json`:

```json
{ "aoi": { "src": "images/art/aoi.png", "focus": "50% 14%", "fit": "cover" } }
```

Or, fastest: tap **+** on a theme card in the app. That stores the image in
the browser on that device only — nothing is uploaded, and it works from a
phone.

> Only use art you have the right to use. Anything you add is yours to clear.
