import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const agentsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Gallery shell must not add horizontal padding on mobile — `main` already
 * has `p-4`. Desktop keeps a light `md:px-2` gutter.
 */
function galleryShellClass(source: string): string {
  const match = source.match(/className="(space-y-16[^"]*)"/);
  if (!match) {
    throw new Error("No agents gallery shell className found");
  }
  return match[1];
}

describe("agents gallery mobile padding contract", () => {
  it("page and loading shells use md:px-2 only (no mobile px-*)", () => {
    const page = readFileSync(path.join(agentsDir, "page.tsx"), "utf8");
    const loading = readFileSync(path.join(agentsDir, "loading.tsx"), "utf8");

    const pageShell = galleryShellClass(page);
    const loadingShell = galleryShellClass(loading);
    const tokens = pageShell.split(/\s+/);

    expect(pageShell).toBe(loadingShell);
    expect(tokens).toContain("md:px-2");
    expect(tokens).not.toContain("px-2");
    expect(tokens).not.toContain("px-4");
  });
});
