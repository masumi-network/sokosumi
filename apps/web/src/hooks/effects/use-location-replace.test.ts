import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLocationReplace } from "./use-location-replace";

describe("useLocationReplace", () => {
  let replaceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    replaceSpy = vi
      .spyOn(window.location, "replace")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    replaceSpy.mockRestore();
  });

  it("does nothing while the target url is null", () => {
    renderHook(() => useLocationReplace(null));
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it("replaces window.location when a target url is provided", () => {
    renderHook(() => useLocationReplace("/tasks"));
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith("/tasks");
  });

  it("replaces once when transitioning from null to a url and ignores identical rerenders", () => {
    const { rerender } = renderHook(
      ({ url }: { url: string | null }) => useLocationReplace(url),
      { initialProps: { url: null as string | null } },
    );
    expect(replaceSpy).not.toHaveBeenCalled();

    rerender({ url: "/setup/assistant" });
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith("/setup/assistant");

    rerender({ url: "/setup/assistant" });
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });
});
