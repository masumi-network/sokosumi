import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatHomePageSkeleton } from "./chat-home-loading-view";

describe("ChatHomePageSkeleton", () => {
  // Welcome Instant Nav bones for `/` (both breakpoints).
  it("gives each breakpoint its own welcome bones", () => {
    render(<ChatHomePageSkeleton />);

    const desktop = screen.getByTestId("chat-home-loading-desktop");
    expect(desktop.className).toMatch(/md:flex/);
    expect(desktop.className).toMatch(/hidden/);

    const mobile = screen.getByTestId("chat-home-loading-mobile");
    expect(mobile.className).toMatch(/md:hidden/);
    // Featured face flanked by four teammates, at the compact scale.
    expect(mobile.querySelectorAll(".size-11")).toHaveLength(4);
    expect(mobile.querySelector(".size-20")).not.toBeNull();
  });

  it("no longer renders the chats-list shell on mobile", () => {
    render(<ChatHomePageSkeleton />);
    expect(screen.queryByTestId("chat-chats-loading")).toBeNull();
  });

  it("mirrors the landing's shape: greeting, stat, avatar and CTA", () => {
    render(<ChatHomePageSkeleton />);

    const bones = [
      ...screen
        .getByTestId("chat-home-loading-desktop")
        .querySelectorAll('[data-slot="skeleton"]'),
    ];

    expect(bones).toHaveLength(5);
    expect(bones.some((bone) => bone.className.includes("rounded-full"))).toBe(
      true,
    );
  });

  it("stays a sync shell of pulse bones (no async APIs)", () => {
    const { container } = render(<ChatHomePageSkeleton />);

    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThanOrEqual(5);
  });
});
