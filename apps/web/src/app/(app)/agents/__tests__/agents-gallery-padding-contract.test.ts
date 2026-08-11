import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const agentsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Hub list pages (`/tasks`, `/projects`) use content-shell `px-2` on mobile.
 * `/agents` must match that gutter — not `px-4` (which stacks on main's `p-4`
 * and reads wider than sibling hub lists).
 */
function galleryShellClass(source: string): string {
  const match = source.match(/className="(space-y-16[^"]*)"/);
  if (!match) {
    throw new Error("No agents gallery shell className found");
  }
  return match[1];
}

describe("agents gallery mobile padding contract", () => {
  it("page and loading shells use hub-list px-2 (not mobile px-4)", () => {
    const page = readFileSync(path.join(agentsDir, "page.tsx"), "utf8");
    const loading = readFileSync(path.join(agentsDir, "loading.tsx"), "utf8");

    const pageShell = galleryShellClass(page);
    const loadingShell = galleryShellClass(loading);

    expect(pageShell).toBe(loadingShell);
    expect(pageShell.split(/\s+/)).toContain("px-2");
    expect(pageShell.split(/\s+/)).not.toContain("px-4");
    expect(pageShell.split(/\s+/)).not.toContain("md:px-2");
  });
});
