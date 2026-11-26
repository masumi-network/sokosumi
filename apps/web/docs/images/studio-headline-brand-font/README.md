These PNGs are native Canvas output from the production `renderStudioHeadline`
function, using the same deterministic 900 × 900 fixture ad and headline,
“Crafted for everyday rituals.” No app session or paid image request is involved.

- `before.png`: no look, reproducing the original system font and the actual
  `--media-ground` / `--on-media` values from `globals.css`.
- `after.png`: Google Fonts Playfair Display, weight 700, with brand text
  `#A33421` on the brand panel `#F8EDDF`.

From the repository root, with installed dependencies and Node.js 26:

```sh
node apps/web/docs/images/studio-headline-brand-font/render.ts
```

The script uses the installed Puppeteer browser. Pass a Chrome executable path as
the next argument if needed, for example
`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.
It downloads a small headline-only Playfair Display subset from Google Fonts and
caches it in the OS temporary directory; no font binary is committed. Both images
use the production renderer, loaded directly from its TypeScript source. The
script asserts that a real `FontFace` was added and that the outputs differ.
