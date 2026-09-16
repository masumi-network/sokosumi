import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../app/globals.css",
  ),
  "utf8",
);
const darkTheme = css.split(".dark {")[1]?.split("\n}")[0];
const MINIMUM_TEXT_CONTRAST = 4.5;

function neutralLuminance(token: string): number {
  const value = darkTheme?.match(
    new RegExp(`--${token}: hsla\\(0, 0(?:\\.0)?%, ([\\d.]+)%, 1\\)`),
  );
  if (!value) throw new Error(`Expected an opaque neutral token: ${token}`);
  const channel = Number(value[1]) / 100;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

describe("dark muted text", () => {
  it.each(["muted", "quinary", "quaternary"])(
    "remains readable on %s surfaces used by tabs and select controls",
    (surface) => {
      const foreground = neutralLuminance("muted-foreground");
      const background = neutralLuminance(surface);
      const contrast =
        (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05);
      expect(contrast).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST);
    },
  );
});
