import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatChatsPageSkeleton } from "../chat-chats-loading-view";

describe("ChatChatsPageSkeleton", () => {
  it("renders mobile-only chats list skeleton", () => {
    render(<ChatChatsPageSkeleton />);

    const root = screen.getByTestId("chat-chats-loading");
    expect(root.className).toMatch(/md:hidden/);
  });

  it("omits Personal Assistant chrome (beta-gated on the real page)", () => {
    const { container } = render(<ChatChatsPageSkeleton />);
    // List header + rows only — no leading avatar/name PA row or separator.
    expect(container.querySelector("ul")).not.toBeNull();
    expect(container.querySelector("hr")).toBeNull();
    const firstChild = container.querySelector(
      '[data-testid="chat-chats-loading"] > *',
    );
    expect(firstChild?.tagName.toLowerCase()).toBe("div");
    expect(firstChild?.className).toMatch(/justify-between/);
  });

  it("renders multiple list row bones", () => {
    const { container } = render(<ChatChatsPageSkeleton />);
    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBeGreaterThanOrEqual(8);
  });
});
