# Inter subset

`inter.woff2` is Inter 4.001 (variable, SIL Open Font License 1.1, see `OFL.txt`), the Latin file Web serves through `next/font/google`, cut down for the views:

- weight axis limited to 400–700 (Web's regular, medium, semibold and bold);
- Basic Latin, Latin-1, curly quotes, dashes, bullet, ellipsis, euro, trademark, arrows and minus;
- features `kern`, `liga`, `calt`, `tnum`, `case`.

About 26 KB, 35 KB once base64 in a view. `src/shell/font.ts` loads it. Other characters fall back to the system font.

Made with fontTools (`pip install fonttools brotli`) from the Google Fonts Latin file (`apps/cmo-website/public/assets/fonts/inter-variable.woff2` is the same file):

```bash
fonttools varLib.instancer inter-variable.woff2 wght=400:700 -o inter-400-700.ttf
pyftsubset inter-400-700.ttf \
  --unicodes="U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+2013-2014,U+2018-201A,U+201C-201E,U+2022,U+2026,U+2032-2033,U+20AC,U+2122,U+2190-2193,U+2212" \
  --layout-features="kern,liga,calt,tnum,case" --flavor=woff2 --output-file=inter.woff2
```
