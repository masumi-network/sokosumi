import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/chat";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

import { HeaderCenter } from "./header-center.client";
import { HeaderTrailing } from "./header-trailing.client";

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

  it.each(["/seo", "/seo/connections/return"])(
    "hides desktop and mobile Project controls on %s while preserving notifications",
    (pathname) => {
      mockPathname = pathname;
      render(
        <>
          <HeaderCenter
            mobileProjectScope={
              <button type="button">Mobile project selection</button>
            }
          >
            <button type="button">All projects</button>
            <button type="button">Create project</button>
          </HeaderCenter>
          <HeaderTrailing>
            <button type="button">Notifications</button>
          </HeaderTrailing>
        </>,
      );
      expect(screen.queryByRole("button", { name: "All projects" })).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Create project" }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Mobile project selection" }),
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: "Notifications" }),
      ).toBeVisible();
    },
  );

  it.each(["/tasks", "/seo-tools"])(
    "preserves Project controls on %s",
    (pathname) => {
      mockPathname = pathname;
      render(
        <HeaderCenter
          mobileProjectScope={
            <button type="button">Mobile project selection</button>
          }
        >
          <button type="button">All projects</button>
          <button type="button">Create project</button>
        </HeaderCenter>,
      );
      expect(
        screen.getByRole("button", { name: "All projects" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Create project" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Mobile project selection" }),
      ).toBeInTheDocument();
    },
  );
});
