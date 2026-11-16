# Free Passport Photos

A free, no-signup web app for making printable passport photo sheets.

Upload a photo → drag and zoom to frame your face → adjust brightness, contrast, saturation and warmth → download a 4×6 in print ready for any photo lab or home printer.

**Your photo never leaves your browser.** Everything runs client-side; there is no server or upload.

Accepts JPEG, PNG, WebP and HEIC/HEIF (iPhone) photos. Browsers without built-in HEIC support (Chrome, Firefox) get a decoder that is loaded only when needed and runs in memory on your device.

## Supported photo types

| Type | Photo size | Photos per 4×6 in print |
| --- | --- | --- |
| U.S. passport | 2 × 2 in | 6 edge to edge, or 2 with margins |
| Vietnam passport | 4 × 6 cm | up to 4 with crop marks |

You can choose how many copies go on the print. Output is a 300 DPI JPEG (1800 × 1200 or 1200 × 1800 px); print it at 4×6 in, actual size, with no "fit" or "fill" cropping.

Framing guides are approximate. Requirements change and vary by country, so check with your issuing agency before printing.

## Run locally

It's three static files (`index.html`, `style.css`, `app.js`) with no build step:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

It can be hosted as-is on GitHub Pages, Netlify or Cloudflare Pages.

## Third-party code

`vendor/heic-to/` contains an unmodified build of [heic-to](https://github.com/hoppergee/heic-to) (libheif), licensed under LGPL-3.0. See `vendor/heic-to/LICENSE`.
