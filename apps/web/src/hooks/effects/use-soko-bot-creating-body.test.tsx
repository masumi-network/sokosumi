import { render, renderHook } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useSokoBotCreatingBody } from "./use-soko-bot-creating-body";

function CreatingProbe() {
  useSokoBotCreatingBody();
  return null;
}

describe("useSokoBotCreatingBody", () => {
  afterEach(() => {
    delete document.body.dataset.sokoBotCreating;
  });

  it("sets data-soko-bot-creating on mount and deletes it on unmount", () => {
    expect(document.body.dataset.sokoBotCreating).toBeUndefined();

    const { unmount } = renderHook(() => useSokoBotCreatingBody());

    expect(document.body.dataset.sokoBotCreating).toBe("true");
    expect(document.body.getAttribute("data-soko-bot-creating")).toBe("true");

    unmount();

    expect(document.body.dataset.sokoBotCreating).toBeUndefined();
    expect(document.body.hasAttribute("data-soko-bot-creating")).toBe(false);
  });

  it("clears data-soko-bot-creating when hidden under React Activity and restores it on reveal", () => {
    const { rerender } = render(
      <Activity mode="visible">
        <CreatingProbe />
      </Activity>,
    );

    expect(document.body.dataset.sokoBotCreating).toBe("true");

    rerender(
      <Activity mode="hidden">
        <CreatingProbe />
      </Activity>,
    );
    expect(document.body.dataset.sokoBotCreating).toBeUndefined();

    rerender(
      <Activity mode="visible">
        <CreatingProbe />
      </Activity>,
    );
    expect(document.body.dataset.sokoBotCreating).toBe("true");
  });
});
