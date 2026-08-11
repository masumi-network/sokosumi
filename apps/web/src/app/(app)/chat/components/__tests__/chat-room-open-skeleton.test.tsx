import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ChatRoomOpenSkeleton,
  RoomMessageListSkeleton,
} from "../chat-room-open-skeleton";

describe("ChatRoomOpenSkeleton", () => {
  it("renders message-list skeleton without fake composer chrome or copy", () => {
    const { container, getByTestId } = render(<ChatRoomOpenSkeleton />);

    expect(getByTestId("chat-room-loading")).toBeTruthy();
    expect(
      container.querySelector('[data-slot="room-message-list-skeleton"]'),
    ).toBeTruthy();
    // No fake composer bones — real composer paints with the room shell.
    expect(
      container.querySelector('[data-slot="chat-room-open-skeleton-composer"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="chat-room-composer-skeleton"]'),
    ).toBeNull();

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Hello|markdown|Thought|lorem/i);
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(0);
  });
});

describe("RoomMessageListSkeleton", () => {
  it("exposes message-list skeleton slot without invented message bodies", () => {
    const { container, getByTestId } = render(<RoomMessageListSkeleton />);

    expect(getByTestId("room-message-list-skeleton")).toBeTruthy();
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(0);
    expect(container.textContent?.trim() ?? "").toBe("");
  });
});
