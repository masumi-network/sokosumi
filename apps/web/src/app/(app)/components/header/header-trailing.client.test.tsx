import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/chat";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

import { HeaderTrailing } from "./header-trailing.client";

describe("HeaderTrailing", () => {
  beforeEach(() => {
    mockPathname = "/chat";
  });

  it("shows trailing chrome on non-room routes", () => {
    render(
      <HeaderTrailing>
        <span>profile</span>
      </HeaderTrailing>,
    );

    const trailing = screen.getByTestId("header-trailing");
    expect(trailing).toHaveTextContent("profile");
    expect(trailing).not.toHaveAttribute("data-hide-on-mobile-room");
    expect(trailing.className).not.toContain("max-md:hidden");
  });

  it("hides trailing chrome on mobile room routes", () => {
    mockPathname = "/chat/rooms/room-1";
    render(
      <HeaderTrailing>
        <span>profile</span>
      </HeaderTrailing>,
    );

    const trailing = screen.getByTestId("header-trailing");
    expect(trailing).toHaveAttribute("data-hide-on-mobile-room", "true");
    expect(trailing.className).toContain("max-md:hidden");
  });

  it("hides trailing chrome on nested room paths", () => {
    mockPathname = "/chat/rooms/room-1/thread";
    render(
      <HeaderTrailing>
        <span>profile</span>
      </HeaderTrailing>,
    );

    expect(screen.getByTestId("header-trailing")).toHaveAttribute(
      "data-hide-on-mobile-room",
      "true",
    );
  });
});
