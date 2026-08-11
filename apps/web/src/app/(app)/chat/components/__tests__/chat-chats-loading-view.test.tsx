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
    // Welcome block + list header + rows — no PA avatar/name row or separator.
    expect(container.querySelector("ul")).not.toBeNull();
    expect(container.querySelector("hr")).toBeNull();
    const children = container.querySelectorAll(
      '[data-testid="chat-chats-loading"] > *',
    );
    expect(children).toHaveLength(2);
    expect(children[1]?.querySelector(".justify-between")).not.toBeNull();
  });

  // The real page leads with the welcome, so the shell must reserve it or the
  // room list jumps down the moment the page streams in.
  it("reserves the welcome block above the list", () => {
    const { container } = render(<ChatChatsPageSkeleton />);
    const welcome = container.querySelector(
      '[data-testid="chat-chats-loading"] > *',
    );
    // Featured coworker bone (size-20) flanked by four teammates (size-11).
    expect(welcome?.querySelectorAll(".size-11")).toHaveLength(4);
    expect(welcome?.querySelector(".size-20")).not.toBeNull();
  });

  it("renders multiple list row bones", () => {
    const { container } = render(<ChatChatsPageSkeleton />);
    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBeGreaterThanOrEqual(8);
  });
});
