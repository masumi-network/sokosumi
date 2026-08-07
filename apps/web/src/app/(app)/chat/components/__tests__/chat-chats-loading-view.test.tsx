import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatChatsPageSkeleton } from "../chat-chats-loading-view";

describe("ChatChatsPageSkeleton", () => {
  it("renders mobile-only chats list skeleton", () => {
    render(<ChatChatsPageSkeleton />);

    const root = screen.getByTestId("chat-chats-loading");
    expect(root.className).toMatch(/md:hidden/);
  });

  it("renders multiple list row bones", () => {
    const { container } = render(<ChatChatsPageSkeleton />);
    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBeGreaterThanOrEqual(8);
  });
});
