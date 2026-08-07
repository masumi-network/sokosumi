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
    expect(header.className).toContain("pt-[env(safe-area-inset-top)]");
    expect(header.className).toContain("pl-[env(safe-area-inset-left)]");
    expect(header.className).toContain("pr-[env(safe-area-inset-right)]");
    for (const token of APP_HEADER_SAFE_AREA_PADDING_CLASS.split(" ")) {
      expect(header.className).toContain(token);
    }

    const row = header.querySelector("div");
    expect(row?.className).toContain("h-16");
    expect(row?.className).toContain("px-4");
    expect(screen.getByText("controls")).toBeTruthy();
  });
});
