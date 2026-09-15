import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ROOM_COMPOSER_EDITOR_PLACEHOLDER_CLASSNAME,
  ROOM_COMPOSER_TEXTAREA_CLASSNAME,
  RoomComposerEmojiPicker,
} from "./room-message-composer";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

/**
 * True for `p-*`, `py-*`, `pt-*`, `pb-*` under any variant, bracketed ones
 * included. `p-*` counts: a variant that raises specificity, such as
 * `focus:p-4`, beats `py-*` and changes the box height.
 */
function isVerticalPadding(token: string): boolean {
  return /(?:^|:)!?p[ytb]?-/.test(token);
}

function verticalPadding(className: string): string[] {
  return className.split(/\s+/).filter(isVerticalPadding);
}

describe("ROOM_COMPOSER_TEXTAREA_CLASSNAME", () => {
  it("pads the editor symmetrically at each breakpoint, and nowhere else", () => {
    // 0.75rem * 2 + a 1.5rem line = 3rem below md.
    // 0.875rem * 2 + a 1.25rem line = 3rem from md up.
    expect(verticalPadding(ROOM_COMPOSER_TEXTAREA_CLASSNAME)).toEqual([
      "py-3",
      "md:py-3.5",
    ]);
  });

  it("keeps the empty box exactly one line tall", () => {
    expect(ROOM_COMPOSER_TEXTAREA_CLASSNAME).toContain("min-h-12");
  });

  it("keeps the editable font size's default line spacing", () => {
    expect(ROOM_COMPOSER_TEXTAREA_CLASSNAME).not.toMatch(/(?:^|[\s:])leading-/);
  });
});

describe("ROOM_COMPOSER_EDITOR_PLACEHOLDER_CLASSNAME", () => {
  it("clips long placeholders without a scroll container that shifts Gecko's caret", () => {
    expect(ROOM_COMPOSER_EDITOR_PLACEHOLDER_CLASSNAME.split(/\s+/)).toContain(
      "empty:before:overflow-clip",
    );
    expect(ROOM_COMPOSER_EDITOR_PLACEHOLDER_CLASSNAME).not.toMatch(
      /overflow-(?:hidden|auto|scroll)/,
    );
    expect(ROOM_COMPOSER_EDITOR_PLACEHOLDER_CLASSNAME).toContain(
      "empty:before:text-ellipsis",
    );
  });
});

describe("RoomComposerEmojiPicker", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("records the picked emoji as a use", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      <RoomComposerEmojiPicker
        title="Emoji"
        ariaLabel="Emoji"
        onPick={onPick}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Emoji" }));
    await user.type(await screen.findByRole("searchbox"), "joy");
    await user.click(
      await screen.findByRole("button", { name: "face with tears of joy" }),
    );

    expect(onPick).toHaveBeenCalledWith("😂");
    expect(
      JSON.parse(
        window.localStorage.getItem("sokosumi.emoji-picker.recent.v1") ?? "[]",
      ),
    ).toEqual(["😂"]);
  });
});
