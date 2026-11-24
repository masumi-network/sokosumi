import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatHomePageSkeleton } from "./chat-home-loading-view";

describe("ChatHomePageSkeleton", () => {
  // Instant Nav bones for `/`: the Soko Bot Home, one layout on every
  // breakpoint, like the page itself.
  it("mirrors the Soko Bot Home: face, greeting, composer, chips, list", () => {
    render(<ChatHomePageSkeleton />);

    const shell = screen.getByTestId("home-loading");
    // Decorative: assistive tech skips the bones.
    expect(shell.getAttribute("aria-hidden")).toBe("true");
    expect(shell.querySelector(".size-14.rounded-full")).not.toBeNull();
    expect(screen.getByTestId("home-loading-composer")).toBeTruthy();
    expect(
      screen
        .getByTestId("home-loading-chips")
        .querySelectorAll(".rounded-full"),
    ).toHaveLength(3);
    expect(
      screen.getByTestId("home-loading-list").querySelectorAll("li"),
    ).toHaveLength(3);
  });

  it("sizes the composer bone like the composer card and its form gutter", () => {
    render(<ChatHomePageSkeleton />);

    const bone = screen.getByTestId("home-loading-composer");
    // RoomComposer's form: px-3 md:px-5 and the safe-area pb-3 md:pb-6.
    expect(bone.parentElement?.className).toBe("px-3 pb-3 md:px-5 md:pb-6");
    // Card: editor 48px + toolbar (40px buttons, 32px from md) + borders.
    expect(bone.className).toContain("h-27.5");
    expect(bone.className).toContain("md:h-25.5");
  });

  it("no longer draws the retired coworker picker", () => {
    render(<ChatHomePageSkeleton />);

    expect(screen.queryByTestId("chat-home-loading-mobile")).toBeNull();
    expect(screen.queryByTestId("chat-home-loading-desktop")).toBeNull();
    // The picker's featured face and its four flanking teammates.
    expect(document.querySelector(".size-20")).toBeNull();
    expect(document.querySelector(".size-11")).toBeNull();
  });

  it("no longer renders the chats-list shell on mobile", () => {
    render(<ChatHomePageSkeleton />);
    expect(screen.queryByTestId("chat-chats-loading")).toBeNull();
  });

  it("stays a sync shell of pulse bones (no async APIs)", () => {
    const { container } = render(<ChatHomePageSkeleton />);

    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThanOrEqual(5);
  });
});
