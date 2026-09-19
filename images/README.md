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

### Using your own theme art

The bundled portraits are simple generated vectors — deliberately plain,
because they are code, not drawings. Replace them with real artwork any of
three ways, checked in this order:

**1 — In the app (fastest, per device).** Open the theme picker, hover any
card, tap the **+**. The image is stored in that browser's IndexedDB. Nothing
is uploaded anywhere. You can do this from your phone. Tapping the character
on the home screen does the same thing.

**2 — `overrides.json` (permanent, every device).** Commit your images and
list them:

```json
{
  "sakura": "images/art/sakura.png",
  "neon":   { "src": "images/art/rin.jpg", "focus": "54% 22%", "fit": "cover", "scale": 1.05 }
}
```

| key | meaning |
|---|---|
| `src` | path to the image |
| `focus` | point kept in frame when cropped (CSS `background-position`) — e.g. `"50% 20%"` to favour the face |
| `fit` | `cover` fills and crops, `contain` shows the whole image |
| `scale` | slight zoom, e.g. `1.08` |

**3 — overwrite the SVG.** Drop your own `images/themes/sakura.svg` in place.

Ids: `sakura` `neon` `yuki` `ember` `mint` `violet` `hikari` `kurone` `mono`

Real artwork looks best tall (roughly 2:3 or 3:4) with the subject's head in
the upper third — the hero fades the left and bottom edges into the panel,
and the theme cards crop toward `focus`.

> Only use art you have the right to use. Nothing in this repo is copied from
> anywhere; if you add someone else's artwork, that's on you to clear.
