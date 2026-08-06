import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatHomePageSkeleton } from "../chat-home-loading-view";

describe("ChatHomePageSkeleton", () => {
  it("renders mobile hub and desktop welcome skeleton regions", () => {
    render(<ChatHomePageSkeleton />);

    const mobile = screen.getByTestId("chat-home-loading-mobile");
    const desktop = screen.getByTestId("chat-home-loading-desktop");
    expect(mobile.className).toMatch(/md:hidden/);
    expect(desktop.className).toMatch(/md:flex/);
  });

  it("uses pulse skeleton bones (no async APIs)", () => {
    const { container } = render(<ChatHomePageSkeleton />);
    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBeGreaterThanOrEqual(6);
  });
});
