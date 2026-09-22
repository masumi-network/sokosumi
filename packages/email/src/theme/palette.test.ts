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
const HEX_PATTERN = /#[0-9a-fA-F]{3,8}\b/g;

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
        hits: readFileSync(path, "utf8").match(HEX_PATTERN),
        path,
      }))
      .filter((file) => file.hits !== null)
      .map(
        (file) =>
          `${file.path.slice(SRC_DIR.length + 1)}: ${file.hits?.join(", ")}`,
      );

    expect(offenders).toEqual([]);
  });

  it("names the same roles in light and dark", () => {
    expect(Object.keys(DARK_PALETTE).sort()).toEqual(
      Object.keys(LIGHT_PALETTE).sort(),
    );
  });
});
