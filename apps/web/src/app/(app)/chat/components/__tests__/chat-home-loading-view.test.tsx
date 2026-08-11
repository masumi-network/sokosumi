import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatHomePageSkeleton } from "../chat-home-loading-view";

describe("ChatHomePageSkeleton", () => {
  it("splits desktop landing bones from the mobile chats-list bones", () => {
    render(<ChatHomePageSkeleton />);

    const desktop = screen.getByTestId("chat-home-loading-desktop");
    expect(desktop.className).toMatch(/md:flex/);
    expect(desktop.className).toMatch(/hidden/);

    const mobile = screen.getByTestId("chat-chats-loading");
    expect(mobile.className).toMatch(/md:hidden/);
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
