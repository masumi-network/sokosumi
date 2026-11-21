// @vitest-environment happy-dom

import type { CmoCompetitors } from "@sokosumi/core-client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCompetitorsData } from "./use-competitors-data";

describe("useCompetitorsData", () => {
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

  function Probe({
    loadCompetitors,
  }: {
    loadCompetitors: () => Promise<CmoCompetitors | null>;
  }) {
    const { data, failed, reload } = useCompetitorsData(loadCompetitors);
    return (
      <div>
        <span data-state={failed ? "failed" : data ? "ready" : "loading"} />
        <button type="button" onClick={reload}>
          Retry
        </button>
      </div>
    );
  }

  it("loads competitors, marks failure on null, and supports reload", async () => {
    const loadCompetitors = vi
      .fn<() => Promise<CmoCompetitors | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({} as CmoCompetitors);

    await act(async () =>
      root.render(<Probe loadCompetitors={loadCompetitors} />),
    );
    expect(container.querySelector("span")?.getAttribute("data-state")).toBe(
      "failed",
    );

    await act(async () => {
      container.querySelector("button")?.click();
    });
    expect(container.querySelector("span")?.getAttribute("data-state")).toBe(
      "ready",
    );
    expect(loadCompetitors).toHaveBeenCalledTimes(2);
  });

  it("shows failure when loadCompetitors rejects", async () => {
    const loadCompetitors = vi
      .fn<() => Promise<CmoCompetitors | null>>()
      .mockRejectedValueOnce(new Error("network down"));

    await act(async () =>
      root.render(<Probe loadCompetitors={loadCompetitors} />),
    );
    expect(container.querySelector("span")?.getAttribute("data-state")).toBe(
      "failed",
    );
  });
});
