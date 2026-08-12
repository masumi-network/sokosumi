import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatChatsPageSkeleton } from "../chat-chats-loading-view";

describe("ChatChatsPageSkeleton", () => {
  it("renders mobile-only chats list skeleton", () => {
    render(<ChatChatsPageSkeleton />);

    const root = screen.getByTestId("chat-chats-loading");
    expect(root.className).toMatch(/md:hidden/);
  });

  it("grows with content (no nested overflow height-lock, no create-FAB pad)", () => {
    render(<ChatChatsPageSkeleton />);

    const root = screen.getByTestId("chat-chats-loading");
    // Nested min-h-0 + overflow-y-auto clips the last row under the fixed
    // tab bar; AppMobileChrome's in-flow spacer needs natural growth.
    expect(root.className).not.toMatch(/overflow-y-auto/);
    expect(root.className).not.toMatch(/\bmin-h-0\b/);
    // Create FAB no longer mounts on /chat/chats.
    expect(root.className).not.toMatch(/pb-\[/);
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
