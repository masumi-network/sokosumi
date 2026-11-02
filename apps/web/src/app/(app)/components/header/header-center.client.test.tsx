import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/chat";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

import { HeaderCenter } from "./header-center.client";

describe("HeaderCenter", () => {
  beforeEach(() => {
    mockPathname = "/chat";
  });

  it("hides the empty room slot on non-room routes", () => {
    render(
      <HeaderCenter>
        <span>scope</span>
      </HeaderCenter>,
    );

    const roomSlot = screen.getByTestId("header-room-slot");
    const roomSlotClasses = roomSlot.className.split(/\s+/);

    expect(roomSlotClasses).toContain("hidden");
    expect(roomSlotClasses).not.toContain("flex");
    expect(roomSlot).not.toHaveAttribute("data-mobile-room");
  });

  it("shows the room slot below md on room routes", () => {
    mockPathname = "/chat/rooms/room-1";
    render(
      <HeaderCenter>
        <span>scope</span>
      </HeaderCenter>,
    );

    const roomSlot = screen.getByTestId("header-room-slot");
    const roomSlotClasses = roomSlot.className.split(/\s+/);

    expect(roomSlot).toHaveAttribute("data-mobile-room", "true");
    expect(roomSlotClasses).toContain("flex");
    expect(roomSlotClasses).toContain("md:hidden");
    expect(roomSlotClasses).not.toContain("hidden");
  });

  it("claims the selector's space from md, never beside the room slot", () => {
    mockPathname = "/chat/rooms/room-1";
    render(
      <HeaderCenter>
        <span>scope</span>
      </HeaderCenter>,
    );

    const scope = screen.getByTestId("header-scope");
    const scopeClasses = scope.className.split(/\s+/);

    expect(scope).toHaveTextContent("scope");
    expect(scopeClasses).toContain("hidden");
    expect(scopeClasses).toContain("md:flex");
    expect(scopeClasses).not.toContain("sm:flex");
  });
});
