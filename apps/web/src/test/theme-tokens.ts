import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reads colour tokens straight from `globals.css`, so a contrast test measures
 * what ships. One parser for every such test: three copies had drifted apart
 * on both the sRGB threshold and the whitespace they accepted.
 */
const css = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../app/globals.css",
  ),
  "utf8",
);

function block(selector: string): string {
  return (
    css.match(new RegExp(`\\n${selector}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? ""
  );
}

export const GLOBALS_CSS = css;
export const THEMES = { light: block(":root"), dark: block("\\.dark") };
export const BRIDGES = block("@theme inline");

function linear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

/** sRGB relative luminance of an opaque token, WCAG 2.2 definition. */
export function luminanceOf(theme: string, token: string): number {
  const hex = theme.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (hex) {
    const [r, g, b] = [1, 3, 5].map((i) =>
      linear(Number.parseInt(hex[1].slice(i, i + 2), 16) / 255),
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const hsla = theme.match(
    new RegExp(`--${token}:\\s*hsla\\(([^)]*),\\s*1(?:\\.0)?\\)\\s*;`),
  );
  if (!hsla) throw new Error(`Expected an opaque token: --${token}`);
  const [h, s, l] = hsla[1].split(",").map((part) => Number.parseFloat(part));
  const amplitude = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return linear(
      l / 100 - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1)),
    );
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

/** WCAG contrast ratio between two tokens in one theme. */
export function contrastOf(theme: string, a: string, b: string): number {
  const [x, y] = [luminanceOf(theme, a), luminanceOf(theme, b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
