import { render, renderHook } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { usePageSearchPartialMarker } from "./use-page-search-partial-marker";

describe("usePageSearchPartialMarker", () => {
  it("registers (0, true) in passive effect phase only while partial is true and cleans up when cleared or unmounted", () => {
    const cleanups: Array<ReturnType<typeof vi.fn>> = [];
    const register = vi.fn((_hits: number, _hasMore: boolean) => {
      const cleanup = vi.fn();
      cleanups.push(cleanup);
      return cleanup;
    });
    const layoutCalls: number[] = [];

    function Probe({ partial }: { partial: boolean }) {
      usePageSearchPartialMarker(register, partial);
      useLayoutEffect(() => {
        layoutCalls.push(register.mock.calls.length);
      }, []);
      return null;
    }

    const { rerender, unmount } = render(<Probe partial={false} />);
    expect(layoutCalls).toEqual([0]);
    expect(register).not.toHaveBeenCalled();

    rerender(<Probe partial />);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenLastCalledWith(0, true);

    rerender(<Probe partial={false} />);
    expect(cleanups[0]).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledTimes(1);

    rerender(<Probe partial />);
    expect(register).toHaveBeenCalledTimes(2);
    unmount();
    expect(cleanups[1]).toHaveBeenCalledTimes(1);
  });

  it("no-ops safely when register is undefined", () => {
    expect(() =>
      renderHook(() => usePageSearchPartialMarker(undefined, true)),
    ).not.toThrow();
  });
});
