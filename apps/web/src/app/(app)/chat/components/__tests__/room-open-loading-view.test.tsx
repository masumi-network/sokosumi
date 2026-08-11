import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-keyboard-open", () => ({
  useKeyboardOpen: () => false,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/app/chat/utils/format-toolbar-preference-storage", () => ({
  getFormatToolbarOpenPreference: () => null,
  resolveFormatToolbarOpenOnMount: () => true,
}));

import { RoomOpenLoadingView } from "../room-open-loading-view";

describe("RoomOpenLoadingView", () => {
  it("shows message-list skeleton and live-matching composer chrome", () => {
    const { container, getByTestId } = render(<RoomOpenLoadingView />);

    expect(getByTestId("chat-room-loading")).toBeTruthy();
    expect(getByTestId("room-message-list-skeleton")).toBeTruthy();
    expect(
      container.querySelector("[data-room-composer-mention-anchor]"),
    ).toBeTruthy();
    // Full format strip (not a 2-icon stub) when desktop-default open.
    expect(container.querySelector('[role="toolbar"]')).toBeTruthy();
    // Bottom tools: attach, Aa, emoji (SmilePlus), mention — same as RoomComposer.
    expect(container.querySelectorAll("button").length).toBeGreaterThan(5);
    expect(container.querySelector(".animate-spin")).toBeNull();
  });
});
