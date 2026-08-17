import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

const here = dirname(fileURLToPath(import.meta.url));
const roomsDir = join(here, "../../rooms/[roomId]");

describe("RoomOpenLoadingView", () => {
  it("paints composer chrome instantly with the list skeleton", () => {
    const { container, getByTestId } = render(<RoomOpenLoadingView />);

    expect(getByTestId("chat-room-loading")).toBeTruthy();
    expect(container.querySelector("main")).toBeTruthy();
    expect(container.querySelector("section")).toBeTruthy();
    expect(getByTestId("room-message-list-skeleton")).toBeTruthy();
    expect(container.querySelector(".flex-row-reverse")).toBeNull();
    // Instant first paint must include composer chrome. A composer-less
    // hole leaves transcript bones flush with the viewport bottom.
    expect(
      container.querySelector("[data-room-composer-mention-anchor]"),
    ).toBeTruthy();
    expect(container.querySelector("form")).toBeTruthy();
    expect(container.querySelector("[data-placeholder]")).toBeTruthy();
    expect(container.querySelector('[role="toolbar"]')).toBeTruthy();
    expect(container.querySelectorAll("button").length).toBeGreaterThan(5);
    expect(container.querySelector(".animate-spin")).toBeNull();
  });
});

describe("chat room Instant / Suspense fallback contract", () => {
  it("loading.tsx uses RoomOpenLoadingView", () => {
    const source = readFileSync(join(roomsDir, "loading.tsx"), "utf8");
    expect(source).toMatch(/RoomOpenLoadingView/);
  });

  it("page Suspense fallback is RoomOpenLoadingView", () => {
    const source = readFileSync(join(roomsDir, "page.tsx"), "utf8");
    expect(source).toMatch(
      /Suspense\s+fallback=\{\s*<RoomOpenLoadingView\s*\/>\s*\}/,
    );
  });
});
