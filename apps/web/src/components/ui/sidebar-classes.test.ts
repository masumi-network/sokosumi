import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const UI_DIR = join(process.cwd(), "src/components/ui");

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
    const source = readFileSync(join(UI_DIR, "sidebar-classes.ts"), "utf8");
    const firstStatement = source.split("\n").find((line) => line.trim() !== "");

    expect(firstStatement).not.toMatch(/use client/);
  });

  it("are not re-exported from the client sidebar module", () => {
    const source = readFileSync(join(UI_DIR, "sidebar.tsx"), "utf8");
    const exportBlock = source.slice(source.lastIndexOf("export {"));

    for (const name of [
      "SIDEBAR_COLLAPSE_TRANSITION",
      "SIDEBAR_RAIL_SQUARE_CLASS",
      "SIDEBAR_ROW_CLASS",
      "SIDEBAR_ROW_LABEL_CLASS",
      "SIDEBAR_ROW_LABEL_INSET_CLASS",
      "SIDEBAR_ROW_RAIL_PAD_CLASS",
    ]) {
      expect(exportBlock).not.toContain(name);
    }
  });
});
