import { render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { PageListSearchContext } from "@/components/page-list-search";
import { useToolConnectorsLinkedQuerySeed } from "./use-tool-connectors-linked-query-seed";

describe("useToolConnectorsLinkedQuerySeed", () => {
  it("seeds the enclosing PageListSearchContext in passive effect phase only when writable and configured", () => {
    const setQuery = vi.fn();
    const register = vi.fn(() => vi.fn());
    const layoutCalls: number[] = [];

    function Probe({
      linkedQuery,
      readOnly,
      configured,
      tick: _tick,
    }: {
      linkedQuery: string;
      readOnly: boolean;
      configured: boolean;
      tick?: number;
    }) {
      useToolConnectorsLinkedQuerySeed(linkedQuery, readOnly, configured);
      useLayoutEffect(() => {
        layoutCalls.push(setQuery.mock.calls.length);
      }, []);
      return null;
    }

    const contextValue = { query: "", setQuery, register };
    const { rerender } = render(
      <PageListSearchContext.Provider value={contextValue}>
        <Probe linkedQuery="figma" readOnly={false} configured tick={1} />
      </PageListSearchContext.Provider>,
    );

    expect(layoutCalls).toEqual([0]);
    expect(setQuery).toHaveBeenCalledTimes(1);
    expect(setQuery).toHaveBeenLastCalledWith("figma");

    // Same inputs do not re-seed.
    rerender(
      <PageListSearchContext.Provider value={contextValue}>
        <Probe linkedQuery="figma" readOnly={false} configured tick={2} />
      </PageListSearchContext.Provider>,
    );
    expect(setQuery).toHaveBeenCalledTimes(1);

    // Changing linkedQuery seeds the new value.
    rerender(
      <PageListSearchContext.Provider value={contextValue}>
        <Probe linkedQuery="slack" readOnly={false} configured tick={3} />
      </PageListSearchContext.Provider>,
    );
    expect(setQuery).toHaveBeenCalledTimes(2);
    expect(setQuery).toHaveBeenLastCalledWith("slack");
  });

  it("does not seed when linkedQuery is empty, readOnly is true, configured is false, or outside PageListSearchContext", () => {
    const setQuery = vi.fn();
    const register = vi.fn(() => vi.fn());
    const contextValue = { query: "", setQuery, register };

    function Probe({
      linkedQuery,
      readOnly,
      configured,
    }: {
      linkedQuery: string;
      readOnly: boolean;
      configured: boolean;
    }) {
      useToolConnectorsLinkedQuerySeed(linkedQuery, readOnly, configured);
      return null;
    }

    const { rerender } = render(
      <PageListSearchContext.Provider value={contextValue}>
        <Probe linkedQuery="" readOnly={false} configured />
      </PageListSearchContext.Provider>,
    );
    expect(setQuery).not.toHaveBeenCalled();

    rerender(
      <PageListSearchContext.Provider value={contextValue}>
        <Probe linkedQuery="figma" readOnly configured />
      </PageListSearchContext.Provider>,
    );
    expect(setQuery).not.toHaveBeenCalled();

    rerender(
      <PageListSearchContext.Provider value={contextValue}>
        <Probe linkedQuery="figma" readOnly={false} configured={false} />
      </PageListSearchContext.Provider>,
    );
    expect(setQuery).not.toHaveBeenCalled();

    // Outside PageListSearchContext it no-ops safely.
    expect(() =>
      render(<Probe linkedQuery="figma" readOnly={false} configured />),
    ).not.toThrow();
    expect(setQuery).not.toHaveBeenCalled();
  });
});
