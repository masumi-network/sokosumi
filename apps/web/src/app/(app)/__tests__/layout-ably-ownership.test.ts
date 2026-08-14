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
    // Gate resolves outside chrome Suspense so not-ready users never see
    // sidebar/header skeletons (SOK-797). Nesting order is load-bearing:
    // gate must wrap SidebarProvider, not sit inside it.
    expect(source).toContain("WorkspaceAccessGate");
    expect(source).toContain("AppAccessCheckingFallback");
    const gateOpen = source.indexOf("<WorkspaceAccessGate>");
    const sidebarOpen = source.indexOf("<SidebarProvider");
    const gateClose = source.indexOf("</WorkspaceAccessGate>");
    expect(gateOpen).toBeGreaterThanOrEqual(0);
    expect(sidebarOpen).toBeGreaterThan(gateOpen);
    expect(gateClose).toBeGreaterThan(sidebarOpen);
  });
});
