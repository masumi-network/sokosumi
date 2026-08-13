import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RoomOpenLoadingView } from "../room-open-loading-view";

const here = dirname(fileURLToPath(import.meta.url));
const roomsDir = join(here, "../../rooms/[roomId]");

describe("RoomOpenLoadingView", () => {
  it("is composer-less (list skeleton only) so missing rooms never flash send UI", () => {
    const { container, getByTestId, queryByTestId } = render(
      <RoomOpenLoadingView />,
    );

    expect(getByTestId("chat-room-loading")).toBeTruthy();
    expect(getByTestId("room-message-list-skeleton")).toBeTruthy();
    expect(queryByTestId("room-session-composer")).toBeNull();
    expect(
      container.querySelector("[data-room-composer-mention-anchor]"),
    ).toBeNull();
    expect(container.querySelector("[data-placeholder]")).toBeNull();
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });
});

describe("chat room Instant / Suspense fallback contract", () => {
  it("loading.tsx uses composer-less RoomOpenLoadingView", () => {
    const source = readFileSync(join(roomsDir, "loading.tsx"), "utf8");
    expect(source).toMatch(/RoomOpenLoadingView/);
    expect(source).not.toMatch(/RoomMessageComposer|room-session-composer/);
  });

  it("page Suspense fallback is composer-less RoomOpenLoadingView", () => {
    const source = readFileSync(join(roomsDir, "page.tsx"), "utf8");
    expect(source).toMatch(
      /Suspense\s+fallback=\{\s*<RoomOpenLoadingView\s*\/>\s*\}/,
    );
  });
});
