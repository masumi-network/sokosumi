import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const UI_DIR = dirname(fileURLToPath(import.meta.url));

const CLASS_NAMES = [
  "SIDEBAR_COLLAPSE_TRANSITION",
  "SIDEBAR_RAIL_SQUARE_CLASS",
  "SIDEBAR_ROW_CLASS",
  "SIDEBAR_ROW_LABEL_CLASS",
  "SIDEBAR_ROW_LABEL_INSET_CLASS",
  "SIDEBAR_ROW_RAIL_PAD_CLASS",
] as const;

/** Drop comments so the file's `"use client"` docs do not false-positive. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * The row-shape constants are plain strings, and Server Components
 * (`AppSidebarFallback`'s skeleton and account chip) read them. A string
 * imported across the `"use client"` boundary arrives as a client reference,
 * not the string, so `cn()` returned `""` and every skeleton row rendered as
 * a bare block — no flex, no height, no padding. Keeping this module off the
 * client side of the boundary is what stops that.
 */
describe("sidebar class constants", () => {
  it("are not behind a client boundary", () => {
    const source = stripComments(
      readFileSync(join(UI_DIR, "sidebar-classes.ts"), "utf8"),
    );

    expect(source).not.toMatch(/["']use client["']/);
  });

  it("are not re-exported from the client sidebar module", () => {
    const source = stripComments(
      readFileSync(join(UI_DIR, "sidebar.tsx"), "utf8"),
    );
    const exportLists = [...source.matchAll(/export\s*\{([^}]+)\}/g)].map(
      (match) => match[1],
    );

    expect(source).not.toMatch(
      /export\s+\*\s+from\s+["'][^"']*sidebar-classes["']/,
    );
    for (const name of CLASS_NAMES) {
      expect(exportLists.some((block) => block.includes(name))).toBe(false);
      expect(source).not.toMatch(new RegExp(`export\\s+const\\s+${name}\\b`));
    }
  });
});
