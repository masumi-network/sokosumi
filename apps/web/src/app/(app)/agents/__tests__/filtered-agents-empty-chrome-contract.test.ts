import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Empty filter matches must keep FilterSection mounted so kind/search chrome
 * stays usable (x402 with zero matches previously blanked the tabs).
 */
describe("filtered-agents empty-match chrome contract", () => {
  it("does not early-return AgentsNotFound before FilterSection", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/app/(app)/agents/components/filtered-agents.tsx",
      ),
      "utf8",
    );

    expect(source).toMatch(/FilterSection/);
    expect(source).not.toMatch(
      /if\s*\(!filteredAgents\.length\)\s*\{\s*return\s*<AgentsNotFound/,
    );
    expect(source).toMatch(
      /!filteredAgents\.length\s*\?\s*\(\s*<AgentsNotFound/,
    );
  });
});
