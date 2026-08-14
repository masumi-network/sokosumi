import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CHAT_CHATS_MOBILE_LIST_SHELL_CLASS } from "../../chat-chats-list-shell";

import { ChatChatsPageSkeleton } from "../chat-chats-loading-view";

describe("ChatChatsPageSkeleton", () => {
  it("renders mobile-only chats list skeleton", () => {
    render(<ChatChatsPageSkeleton />);

    const root = screen.getByTestId("chat-chats-loading");
    expect(root.className).toMatch(/md:hidden/);
  });

  it("uses the shared list shell so the last row clears the tab bar", () => {
    render(<ChatChatsPageSkeleton />);

    const root = screen.getByTestId("chat-chats-loading");
    for (const token of CHAT_CHATS_MOBILE_LIST_SHELL_CLASS.split(/\s+/)) {
      // Token match — substring `toContain("flex")` would pass on `flex-1`.
      expect(root.classList.contains(token)).toBe(true);
    }
    // Nested min-h-0 + overflow-y-auto clips the last row under the fixed
    // tab bar; AppMobileChrome's in-flow spacer needs natural growth.
    expect(root.className).not.toMatch(/overflow-y-auto/);
    expect(root.className).not.toMatch(/\bmin-h-0\b/);
    // Full four-side -m-4 pulls the spacer into the last rows.
    expect(root.className).not.toMatch(/(?:^|\s)-m-4(?:\s|$)/);
    expect(root.className).not.toMatch(/-mb-/);
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
