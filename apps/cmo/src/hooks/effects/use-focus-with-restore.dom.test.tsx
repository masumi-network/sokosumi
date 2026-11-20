// @vitest-environment happy-dom

import { Activity, act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFocusWithRestore } from "./use-focus-with-restore";

describe("useFocusWithRestore (CMO)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("focuses the target on mount and restores focus to the opener with preventScroll on unmount", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const openerFocus = vi.spyOn(opener, "focus");

    function Sheet({ tick }: { tick: number }) {
      void tick;
      const sheetRef = useRef<HTMLElement>(null);
      useFocusWithRestore(sheetRef);
      return (
        <aside ref={sheetRef} tabIndex={-1}>
          Panel
        </aside>
      );
    }

    await act(async () => root.render(<Sheet tick={0} />));
    const aside = container.querySelector("aside");
    expect(document.activeElement).toBe(aside);
    expect(openerFocus).not.toHaveBeenCalled();

    // Re-rendering does not restore or steal focus.
    await act(async () => root.render(<Sheet tick={1} />));
    expect(openerFocus).not.toHaveBeenCalled();

    await act(async () => root.render(null));
    expect(openerFocus).toHaveBeenCalledTimes(1);
    expect(openerFocus).toHaveBeenCalledWith({ preventScroll: true });

    opener.remove();
  });

  it("restores on Activity hide and re-focuses on reveal without throwing during SSR", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const openerFocus = vi.spyOn(opener, "focus");

    function Sheet() {
      const sheetRef = useRef<HTMLElement>(null);
      useFocusWithRestore(sheetRef);
      return (
        <aside ref={sheetRef} tabIndex={-1}>
          Panel
        </aside>
      );
    }

    await act(async () =>
      root.render(
        <Activity mode="visible">
          <Sheet />
        </Activity>,
      ),
    );
    const aside = container.querySelector("aside");
    expect(document.activeElement).toBe(aside);

    await act(async () =>
      root.render(
        <Activity mode="hidden">
          <Sheet />
        </Activity>,
      ),
    );
    expect(openerFocus).toHaveBeenCalledWith({ preventScroll: true });

    await act(async () =>
      root.render(
        <Activity mode="visible">
          <Sheet />
        </Activity>,
      ),
    );
    expect(document.activeElement).toBe(aside);

    opener.remove();
    expect(renderToString(<Sheet />)).toContain("Panel");
  });
});
