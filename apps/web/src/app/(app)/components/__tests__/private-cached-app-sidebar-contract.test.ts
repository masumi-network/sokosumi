import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Regression lock for empty-chrome Instant Nav bug: a secondary getSession()
 * miss inside `"use cache: private"` returned null, which Cache Components
 * can keep for cacheLife.stale while the rest of the authenticated shell
 * stayed mounted.
 */
describe("PrivateCachedAppSidebar session contract", () => {
  const source = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../private-cached-app-sidebar.tsx",
    ),
    "utf8",
  );

  it("does not re-fetch session and return null empty chrome", () => {
    expect(source).not.toMatch(/\bgetSession\s*\(/);
    expect(source).not.toMatch(/\breturn\s+null\b/);
  });

  it("takes sessionUser from the authenticated frame instead", () => {
    expect(source).toMatch(/sessionUser:\s*SessionUser/);
  });
});
