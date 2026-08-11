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
  it("uses shared room shell tree with left-aligned skeleton and composer", () => {
    const { container, getByTestId } = render(<RoomOpenLoadingView />);

    expect(getByTestId("chat-room-loading")).toBeTruthy();
    expect(container.querySelector("main")).toBeTruthy();
    expect(container.querySelector("section")).toBeTruthy();
    expect(getByTestId("room-message-list-skeleton")).toBeTruthy();
    expect(container.querySelector(".flex-row-reverse")).toBeNull();
    expect(
      container.querySelector("[data-room-composer-mention-anchor]"),
    ).toBeTruthy();
    expect(container.querySelector("[data-placeholder]")).toBeTruthy();
    expect(container.querySelector('[role="toolbar"]')).toBeTruthy();
    expect(container.querySelectorAll("button").length).toBeGreaterThan(5);
    expect(container.querySelector(".animate-spin")).toBeNull();
  });
});
