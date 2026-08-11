import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ChatRoomOpenSkeleton,
  RoomMessageListSkeleton,
} from "../chat-room-open-skeleton";

describe("ChatRoomOpenSkeleton", () => {
  it("renders header, message-list, and composer bones without real copy", () => {
    const { container, getByTestId } = render(<ChatRoomOpenSkeleton />);

    expect(getByTestId("chat-room-loading")).toBeTruthy();
    expect(
      container.querySelector('[data-slot="chat-room-open-skeleton-header"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-slot="room-message-list-skeleton"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-slot="chat-room-open-skeleton-composer"]'),
    ).toBeTruthy();

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Hello|markdown|Thought|lorem/i);
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(4);
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
