// @vitest-environment happy-dom

import type { CmoTikTokCreator } from "@sokosumi/core-client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTikTokCreator } from "./use-tiktok-creator";

describe("useTikTokCreator", () => {
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
    draftId,
    readCreator,
  }: {
    draftId: string;
    readCreator: (
      draftId: string,
    ) => Promise<{ creator: CmoTikTokCreator | null; error: string | null }>;
  }) {
    const { creator, error } = useTikTokCreator(draftId, readCreator);
    return (
      <span
        data-creator={creator ? "yes" : "no"}
        data-error={error ?? "none"}
      />
    );
  }

  it("reads the TikTok creator for draftId and falls back to error copy on rejection", async () => {
    const readCreator = vi
      .fn<
        (
          draftId: string,
        ) => Promise<{ creator: CmoTikTokCreator | null; error: string | null }>
      >()
      .mockResolvedValueOnce({
        creator: {} as CmoTikTokCreator,
        error: null,
      })
      .mockRejectedValueOnce(new Error("network"));

    await act(async () =>
      root.render(<Probe draftId="d-1" readCreator={readCreator} />),
    );
    expect(container.querySelector("span")?.getAttribute("data-creator")).toBe(
      "yes",
    );
    expect(container.querySelector("span")?.getAttribute("data-error")).toBe(
      "none",
    );

    await act(async () =>
      root.render(<Probe draftId="d-2" readCreator={readCreator} />),
    );
    expect(container.querySelector("span")?.getAttribute("data-error")).toBe(
      "TikTok could not be read. Try again.",
    );
  });
});
