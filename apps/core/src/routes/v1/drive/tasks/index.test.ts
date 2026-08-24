import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("drive tasks routes", () => {
  it("enables workspace middleware so Level 3 file reads can resolve", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "index.ts"),
      "utf8",
    );
    expect(source).toMatch(/includeWorkspaceContext:\s*true/);
  });
});
