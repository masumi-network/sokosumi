// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLoaded } from "./use-loaded";

describe("useLoaded (CMO)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let seen: { value: unknown; failed: boolean; reload: () => void };

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
  });

  function Probe({ load }: { load: () => Promise<string | null> }) {
    seen = useLoaded(load);
    return null;
  }

  it("loads on mount, again on reload, and says when it failed", async () => {
    const load = vi.fn(async () => "pictures");
    await act(async () => root.render(<Probe load={load} />));
    expect(seen.value).toBe("pictures");
    await act(async () => seen.reload());
    expect(load).toHaveBeenCalledTimes(2);
    const empty = async () => null;
    await act(async () => root.render(<Probe load={empty} />));
    expect(seen.failed).toBe(true);
  });

  it("drops a load that a newer one overtook", async () => {
    let resolveFirst: (value: string) => void = () => {};
    const first = () =>
      new Promise<string>((resolve) => {
        resolveFirst = resolve;
      });
    await act(async () => root.render(<Probe load={first} />));
    await act(async () => root.render(<Probe load={async () => "new"} />));
    await act(async () => resolveFirst("old"));
    expect(seen.value).toBe("new");
  });
});
