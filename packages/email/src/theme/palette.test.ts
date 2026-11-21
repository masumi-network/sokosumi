import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DARK_PALETTE, LIGHT_PALETTE } from "./palette.js";

const THEME_DIR = fileURLToPath(new URL(".", import.meta.url)).replace(
  /\/$/,
  "",
);
const SRC_DIR = join(THEME_DIR, "..");
const COLOUR_PATTERN = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return path === THEME_DIR ? [] : sourceFiles(path);
    }

    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe("email palette", () => {
  it("is the only place a colour literal appears", () => {
    const offenders = sourceFiles(SRC_DIR)
      .map((path) => ({
        hits: readFileSync(path, "utf8").match(COLOUR_PATTERN),
        path,
      }))
      .filter((file) => file.hits !== null)
      .map(
        (file) =>
          `${file.path.slice(SRC_DIR.length + 1)}: ${file.hits?.join(", ")}`,
      );

    expect(offenders).toEqual([]);
  });
});

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe("email palette contrast", () => {
  it.each([
    ["light", LIGHT_PALETTE],
    ["dark", DARK_PALETTE],
  ])("%s button label and muted text clear AA", (_name, p) => {
    expect(contrast(p.accentForeground, p.accentSolid)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrast(p.textMuted, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.textMuted, p.surfaceSubtle)).toBeGreaterThanOrEqual(4.5);
  });
});
