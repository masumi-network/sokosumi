import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-keyboard-open", () => ({
  useKeyboardOpen: () => false,
}));

import { RoomOpenLoadingView } from "../room-open-loading-view";

describe("RoomOpenLoadingView", () => {
  it("shows message-list skeleton and real composer chrome without spinner copy", () => {
    const { container, getByTestId } = render(<RoomOpenLoadingView />);

    expect(getByTestId("chat-room-loading")).toBeTruthy();
    expect(getByTestId("room-message-list-skeleton")).toBeTruthy();
    // Live composer card (not a full-page DefaultLoading spinner).
    expect(
      container.querySelector("[data-room-composer-mention-anchor]"),
    ).toBeTruthy();
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/Hello|Thought|lorem/i);
  });
});
