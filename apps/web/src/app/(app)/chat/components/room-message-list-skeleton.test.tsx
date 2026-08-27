import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RoomMessageListSkeleton } from "./room-message-list-skeleton";

describe("RoomMessageListSkeleton", () => {
  it("exposes left-aligned multiline list bones without invented message copy", () => {
    const { container, getByTestId } = render(<RoomMessageListSkeleton />);

    expect(getByTestId("room-message-list-skeleton")).toBeTruthy();
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(10);
    expect(getByTestId("room-message-list-skeleton-image")).toBeTruthy();
    expect(container.querySelector(".flex-row-reverse")).toBeNull();
    expect(container.textContent?.trim() ?? "").toBe("");
  });
});
