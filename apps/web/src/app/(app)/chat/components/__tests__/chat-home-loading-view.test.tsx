import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ONBOARDING_STEPS_MAX_WIDTH_CLASS } from "@/app/chat/onboarding/feature-width";

let mockSearch = "";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import {
  ChatHomeBarePageSkeleton,
  ChatHomePageSkeleton,
} from "../chat-home-loading-view";

describe("ChatHomePageSkeleton", () => {
  beforeEach(() => {
    mockSearch = "";
  });

  it("renders desktop onboarding skeleton and mobile chats skeleton on bare /chat", () => {
    render(<ChatHomePageSkeleton />);

    const desktop = screen.getByTestId("chat-home-loading-desktop");
    expect(desktop.className).toMatch(/md:flex/);
    expect(desktop.className).toContain(ONBOARDING_STEPS_MAX_WIDTH_CLASS);
    const mobile = screen.getByTestId("chat-chats-loading");
    expect(mobile.className).toMatch(/md:hidden/);
  });

  it("renders onboarding skeleton on all breakpoints for ?welcome=1", () => {
    mockSearch = "welcome=1";
    render(<ChatHomePageSkeleton />);

    expect(screen.getByTestId("chat-home-loading-onboarding")).toBeTruthy();
    expect(screen.queryByTestId("chat-chats-loading")).toBeNull();
    expect(screen.queryByTestId("chat-home-loading-desktop")).toBeNull();
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

describe("ChatHomeBarePageSkeleton", () => {
  it("falls back to chats + desktop onboarding split", () => {
    render(<ChatHomeBarePageSkeleton />);
    expect(screen.getByTestId("chat-chats-loading")).toBeTruthy();
    expect(screen.getByTestId("chat-home-loading-desktop")).toBeTruthy();
  });
});
