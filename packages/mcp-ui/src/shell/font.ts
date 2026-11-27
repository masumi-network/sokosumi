import interWoff2 from "./fonts/inter.woff2?inline";

/** The name the views' `--font-sans` asks for first. */
export const FONT_FAMILY = "Sokosumi Inter";

/**
 * Adds Web's font, Inter, to the view. The file is embedded in the build
 * (ADR 0083: nothing fetched) and handed to `FontFace` as bytes: hosts' default
 * CSP has no `font-src`, which blocks an `@font-face` with a `data:` URL, but
 * bytes are not a fetch. See fonts/README.md for how the subset is made.
 */
export function loadFont(): void {
  if (typeof FontFace === "undefined" || !document.fonts) return;
  const base64 = interWoff2.slice(interWoff2.indexOf(",") + 1);
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  document.fonts.add(new FontFace(FONT_FAMILY, bytes, { weight: "400 700" }));
}
