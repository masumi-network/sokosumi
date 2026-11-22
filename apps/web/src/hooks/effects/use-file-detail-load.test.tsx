import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useFileDetailLoad } from "./use-file-detail-load";

describe("useFileDetailLoad", () => {
  it("waits while sessionPending is true, loads once settled, and reloads when load changes", () => {
    const firstLoad = vi.fn(async () => {});
    const secondLoad = vi.fn(async () => {});

    const { rerender } = renderHook(
      ({ load, sessionPending }) => useFileDetailLoad(load, sessionPending),
      { initialProps: { load: firstLoad, sessionPending: true } },
    );

    expect(firstLoad).not.toHaveBeenCalled();

    rerender({ load: firstLoad, sessionPending: false });
    expect(firstLoad).toHaveBeenCalledTimes(1);

    rerender({ load: secondLoad, sessionPending: false });
    expect(secondLoad).toHaveBeenCalledTimes(1);
  });
});
