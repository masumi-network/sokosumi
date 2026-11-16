// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { sweepWorkspace } from "./workspace-sweep";

function prefersReducedMotion(matches: boolean) {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches,
  } as MediaQueryList);
}

describe("sweepWorkspace", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs the change at once under reduced motion", async () => {
    prefersReducedMotion(true);
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    const change = vi.fn().mockResolvedValue(undefined);

    await sweepWorkspace(change);

    expect(change).toHaveBeenCalledOnce();
    expect(getContext).not.toHaveBeenCalled();
  });

  it("runs the change without a band where WebGL is missing", async () => {
    prefersReducedMotion(false);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const change = vi.fn().mockResolvedValue(undefined);

    await sweepWorkspace(change);

    expect(change).toHaveBeenCalledOnce();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("passes on a change that fails", async () => {
    prefersReducedMotion(true);
    const failure = new Error("not a member");

    await expect(sweepWorkspace(() => Promise.reject(failure))).rejects.toBe(
      failure,
    );
  });
});
