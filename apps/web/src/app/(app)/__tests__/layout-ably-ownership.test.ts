import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("(app)/layout Ably ownership", () => {
  it("does not import or wrap the shell in LazyAblyProvider", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../layout.tsx"),
      "utf8",
    );

    expect(source).not.toContain("LazyAblyProvider");
    expect(source).not.toContain("lazy-ably-provider");
    expect(source).toContain("SidebarProvider");
    expect(source).toContain("AppShellLoadingFrame");
  });
});
