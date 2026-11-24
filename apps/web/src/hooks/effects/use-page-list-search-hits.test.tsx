import { render, renderHook } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { usePageListSearchHits } from "./use-page-list-search-hits";

describe("usePageListSearchHits", () => {
  it("registers hit count in passive effect phase and cleans up on hit count change, register change, and unmount", () => {
    const cleanups: Array<ReturnType<typeof vi.fn>> = [];
    const registerA = vi.fn((_hits: number, _hasMore: boolean) => {
      const cleanup = vi.fn();
      cleanups.push(cleanup);
      return cleanup;
    });
    const registerB = vi.fn((_hits: number, _hasMore: boolean) => {
      const cleanup = vi.fn();
      cleanups.push(cleanup);
      return cleanup;
    });
    const layoutCalls: number[] = [];

    function Probe({
      register,
      hits,
    }: {
      register: typeof registerA | undefined;
      hits: number;
    }) {
      usePageListSearchHits(register, hits);
      useLayoutEffect(() => {
        layoutCalls.push(registerA.mock.calls.length);
      }, []);
      return null;
    }

    const { rerender, unmount } = render(
      <Probe register={registerA} hits={3} />,
    );

    expect(layoutCalls).toEqual([0]);
    expect(registerA).toHaveBeenCalledTimes(1);
    expect(registerA).toHaveBeenLastCalledWith(3, false);

    // Same hits and register does not re-register.
    rerender(<Probe register={registerA} hits={3} />);
    expect(registerA).toHaveBeenCalledTimes(1);
    expect(cleanups[0]).not.toHaveBeenCalled();

    // Hit count change runs previous cleanup and registers the new count.
    rerender(<Probe register={registerA} hits={1} />);
    expect(cleanups[0]).toHaveBeenCalledTimes(1);
    expect(registerA).toHaveBeenCalledTimes(2);
    expect(registerA).toHaveBeenLastCalledWith(1, false);

    // Register callback change cleans up and registers with the new callback.
    rerender(<Probe register={registerB} hits={1} />);
    expect(cleanups[1]).toHaveBeenCalledTimes(1);
    expect(registerB).toHaveBeenCalledTimes(1);
    expect(registerB).toHaveBeenLastCalledWith(1, false);

    unmount();
    expect(cleanups[2]).toHaveBeenCalledTimes(1);
  });

  it("no-ops safely when register is undefined", () => {
    expect(() =>
      renderHook(() => usePageListSearchHits(undefined, 5)),
    ).not.toThrow();
  });
});
