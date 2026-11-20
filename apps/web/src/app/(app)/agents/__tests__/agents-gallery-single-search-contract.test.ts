import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Agents page has one search. The hero field and the catalog both read
 * the `query` URL key through `useGalleryFilter`, so they cannot desync, and
 * the catalog has no field of its own to compete for Cmd/Ctrl+F. The old
 * `agentQuery` key is read only as a fallback (see use-gallery-filter.test).
 */
describe("agents gallery single search contract", () => {
  const read = (path: string) =>
    readFileSync(join(process.cwd(), path), "utf8");

  it("binds the page search to the query key", () => {
    const source = read("src/hooks/use-gallery-filter.ts");
    expect(source).toMatch(/useQueryState\(\s*["']query["']/);
    expect(source).toMatch(/currentQuery \|\| legacyQuery/);
  });

  it("coworker gallery reads the shared filter", () => {
    const source = read("src/components/agents/coworker-gallery-section.tsx");
    expect(source).toMatch(/useGalleryFilter\(\)/);
    expect(source).not.toMatch(/useQueryState/);
  });

  it("catalog filters own no search field or Cmd/Ctrl+F", () => {
    const source = read("src/app/(app)/agents/components/filter-section.tsx");
    expect(source).not.toMatch(/usePageSearchShortcut|<Input/);
  });
});
