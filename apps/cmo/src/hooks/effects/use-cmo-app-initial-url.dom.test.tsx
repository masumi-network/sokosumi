// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { View } from "../../lib/views";
import { useCmoAppInitialUrl } from "./use-cmo-app-initial-url";

describe("useCmoAppInitialUrl (CMO)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    window.history.replaceState(null, "", "/");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("replaces a query-bearing URL with the initial view path and leaves clean URLs alone", async () => {
    const replaceSpy = vi.spyOn(window.history, "replaceState");

    function Probe({ initialView }: { initialView: View }) {
      useCmoAppInitialUrl(initialView);
      return <span>ok</span>;
    }

    await act(async () => root.render(<Probe initialView="today" />));
    expect(replaceSpy).not.toHaveBeenCalled();

    window.history.replaceState(null, "", "/?step=connect");
    replaceSpy.mockClear();

    await act(async () => root.render(<Probe initialView="channels" />));
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith(null, "", "/channels");
    expect(window.location.pathname).toBe("/channels");
    expect(window.location.search).toBe("");

    expect(renderToString(<Probe initialView="today" />)).toBe(
      "<span>ok</span>",
    );
  });
});
