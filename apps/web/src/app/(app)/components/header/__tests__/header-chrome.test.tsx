import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-is-apple-platform", () => ({
  default: () => true,
}));

import { APP_HEADER_SAFE_AREA_PADDING_CLASS } from "../../app-shell-safe-area";
import { HeaderChrome } from "../header-chrome.client";

describe("HeaderChrome", () => {
  it("applies safe-area padding on the outer header under cover", () => {
    render(
      <HeaderChrome className="px-4 py-3">
        <span>controls</span>
      </HeaderChrome>,
    );

    const header = screen.getByRole("banner");
    const tokens = header.className.split(/\s+/);
    expect(header.className).toContain("pt-[env(safe-area-inset-top)]");
    expect(header.className).toContain("pl-[env(safe-area-inset-left)]");
    expect(header.className).toContain("pr-[env(safe-area-inset-right)]");
    for (const token of APP_HEADER_SAFE_AREA_PADDING_CLASS.split(" ")) {
      expect(header.className).toContain(token);
    }

    // fixed/sticky own the containing block; relative would fight fixed in CSS.
    expect(tokens).toContain("fixed");
    expect(tokens).not.toContain("relative");
    // Desktop hairline is on the h-16 row (matches SidebarHeader), not outer.
    expect(tokens).not.toContain("md:border-b");

    // Glass stays on the full outer chrome (Apple mock).
    expect(header.className).toMatch(/backdrop-blur-2xl/);

    const underlay = header.querySelector(
      "[data-testid='header-safe-area-underlay']",
    );
    expect(underlay?.getAttribute("aria-hidden")).toBe("true");
    expect(underlay?.className).toContain("bg-background");
    expect(underlay?.className).toContain("h-[env(safe-area-inset-top)]");

    // Control row still h-16; desktop border-b lives here (sidebar seam).
    const row = header.querySelector(".h-16");
    expect(row).toBeTruthy();
    expect(row?.className).toContain("px-4");
    expect(row?.className).toContain("md:border-b");
    expect(row?.className).toContain("md:border-sidebar-border");
    expect(screen.getByText("controls")).toBeTruthy();
  });
});
