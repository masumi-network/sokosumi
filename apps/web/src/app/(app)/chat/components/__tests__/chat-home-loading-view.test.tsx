import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatHomePageSkeleton } from "../chat-home-loading-view";

describe("ChatHomePageSkeleton", () => {
  it("renders desktop welcome skeleton and mobile chats skeleton", () => {
    render(<ChatHomePageSkeleton />);

    const desktop = screen.getByTestId("chat-home-loading-desktop");
    expect(desktop.className).toMatch(/md:flex/);
    const mobile = screen.getByTestId("chat-chats-loading");
    expect(mobile.className).toMatch(/md:hidden/);
  });

  it("uses pulse skeleton bones (no async APIs)", () => {
    const { container } = render(<ChatHomePageSkeleton />);
    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBeGreaterThanOrEqual(5);
  });
});
