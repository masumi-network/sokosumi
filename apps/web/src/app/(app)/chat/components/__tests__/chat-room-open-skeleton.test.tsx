import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ChatRoomOpenSkeleton,
  RoomComposerSkeleton,
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

describe("RoomComposerSkeleton", () => {
  it("mirrors live composer card + tool-row geometry classes", () => {
    const { container, getByTestId } = render(<RoomComposerSkeleton />);

    expect(getByTestId("chat-room-composer-skeleton")).toBeTruthy();
    // Rounded card shell (same as RoomMessageComposer).
    expect(
      container.querySelector(".rounded-xl.border.bg-background"),
    ).toBeTruthy();
    // Editor uses shared textarea class (min-h-10 + vertical padding).
    expect(container.querySelector(".min-h-10")).toBeTruthy();
    // Tool buttons use shared size classes.
    expect(container.querySelectorAll(".size-9").length).toBeGreaterThan(3);
    expect(container.textContent?.trim() ?? "").toBe("");
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
