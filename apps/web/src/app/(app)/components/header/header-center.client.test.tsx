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

  it("keeps breadcrumbs at sm and hides empty room slot on non-room routes", () => {
    render(
      <HeaderCenter>
        <span>crumbs</span>
      </HeaderCenter>,
    );

    const roomSlot = screen.getByTestId("header-room-slot");
    const breadcrumbs = screen.getByTestId("header-breadcrumbs");
    const roomSlotClasses = roomSlot.className.split(/\s+/);
    const breadcrumbClasses = breadcrumbs.className.split(/\s+/);

    expect(roomSlotClasses).toContain("hidden");
    expect(roomSlotClasses).not.toContain("flex");
    expect(roomSlot).not.toHaveAttribute("data-mobile-room");

    expect(breadcrumbs).toHaveTextContent("crumbs");
    expect(breadcrumbClasses).toContain("sm:flex");
    expect(breadcrumbClasses).not.toContain("max-md:hidden");
    expect(breadcrumbs).not.toHaveAttribute("data-hide-on-mobile-room");
  });

  it("shows room slot and hides breadcrumbs below md on room routes", () => {
    mockPathname = "/chat/rooms/room-1";
    render(
      <HeaderCenter>
        <span>crumbs</span>
      </HeaderCenter>,
    );

    const roomSlot = screen.getByTestId("header-room-slot");
    const breadcrumbs = screen.getByTestId("header-breadcrumbs");
    const roomSlotClasses = roomSlot.className.split(/\s+/);
    const breadcrumbClasses = breadcrumbs.className.split(/\s+/);

    expect(roomSlot).toHaveAttribute("data-mobile-room", "true");
    expect(roomSlotClasses).toContain("flex");
    expect(roomSlotClasses).toContain("md:hidden");
    expect(roomSlotClasses).not.toContain("hidden");

    expect(breadcrumbs).toHaveAttribute("data-hide-on-mobile-room", "true");
    expect(breadcrumbClasses).not.toContain("sm:flex");
    expect(breadcrumbClasses).toContain("md:flex");
    expect(breadcrumbClasses).not.toContain("max-md:hidden");
  });

  it("does not let breadcrumbs claim sm while the room slot is still visible below md", () => {
    mockPathname = "/chat/rooms/room-1";
    render(
      <HeaderCenter>
        <span>Chat</span>
        <span>Everyone</span>
      </HeaderCenter>,
    );

    const roomSlot = screen.getByTestId("header-room-slot");
    const breadcrumbs = screen.getByTestId("header-breadcrumbs");
    const roomSlotClasses = roomSlot.className.split(/\s+/);
    const breadcrumbClasses = breadcrumbs.className.split(/\s+/);

    expect(roomSlotClasses).toContain("flex");
    expect(roomSlotClasses).toContain("md:hidden");
    expect(breadcrumbClasses).not.toContain("sm:flex");
    expect(breadcrumbClasses).toContain("md:flex");
  });
});
