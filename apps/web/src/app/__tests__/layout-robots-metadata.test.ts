import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("root layout robots metadata", () => {
  it("always noindexes and is not gated on Mainnet", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../layout.tsx"),
      "utf8",
    );

    expect(source).toContain("index: false");
    expect(source).toContain("follow: false");
    expect(source).not.toContain("isMainnet");
    expect(source).not.toMatch(/NEXT_PUBLIC_NETWORK === ["']Mainnet["']/);
  });
});
