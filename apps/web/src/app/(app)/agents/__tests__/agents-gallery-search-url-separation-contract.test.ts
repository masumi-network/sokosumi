import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Coworker gallery and Agent catalog must not share a single search URL key.
 * Catalog owns `agentQuery`; coworker gallery keeps `query`.
 */
describe("agents gallery search URL separation contract", () => {
  it("catalog filter hook binds search to agentQuery", () => {
    const source = readFileSync(
      join(process.cwd(), "src/hooks/use-gallery-filter.ts"),
      "utf8",
    );
    expect(source).toMatch(/useQueryState\(\s*["']agentQuery["']/);
    expect(source).not.toMatch(/useQueryState\(\s*["']query["']/);
  });

  it("coworker gallery binds search to query via useQueryState", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/agents/coworker-gallery-section.tsx"),
      "utf8",
    );
    expect(source).toMatch(/useQueryState\(\s*["']query["']/);
    expect(source).not.toMatch(/useGalleryFilter/);
  });
});
