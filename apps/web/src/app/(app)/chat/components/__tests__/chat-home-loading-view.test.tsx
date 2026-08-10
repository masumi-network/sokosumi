import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ONBOARDING_STEPS_MAX_WIDTH_CLASS } from "@/app/chat/onboarding/feature-width";

import { ChatHomePageSkeleton } from "../chat-home-loading-view";

describe("ChatHomePageSkeleton", () => {
  it("renders desktop onboarding skeleton and mobile chats skeleton", () => {
    render(<ChatHomePageSkeleton />);

    const desktop = screen.getByTestId("chat-home-loading-desktop");
    expect(desktop.className).toMatch(/md:flex/);
    expect(desktop.className).toContain(ONBOARDING_STEPS_MAX_WIDTH_CLASS);
    const mobile = screen.getByTestId("chat-chats-loading");
    expect(mobile.className).toMatch(/md:hidden/);
  });

  it("mirrors questionnaire intent step chrome", () => {
    render(<ChatHomePageSkeleton />);
    const desktop = screen.getByTestId("chat-home-loading-desktop");
    const bones = [...desktop.querySelectorAll('[data-slot="skeleton"]')];
    // greeting + title + description + progress + 3 choices + next
    expect(bones).toHaveLength(8);
    expect(bones.some((bone) => bone.className.includes("h-1.5"))).toBe(true);
    expect(bones.filter((bone) => bone.className.includes("h-20")).length).toBe(
      3,
    );
  });

  it("uses pulse skeleton bones (no async APIs)", () => {
    const { container } = render(<ChatHomePageSkeleton />);
    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBeGreaterThanOrEqual(5);
  });
});
