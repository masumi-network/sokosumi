// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMediaQuery } from "./use-media-query";

function stubMatchMedia(
  initial: Record<string, boolean>,
  options?: { legacyOnly?: boolean },
) {
  const lists = new Map<
    string,
    {
      matches: boolean;
      media: string;
      addEventListener?: ReturnType<typeof vi.fn>;
      removeEventListener?: ReturnType<typeof vi.fn>;
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
      setMatches(next: boolean): void;
    }
  >();

  function getList(query: string) {
    const existing = lists.get(query);
    if (existing) return existing;

    const listeners = new Set<() => void>();
    const mql = {
      matches: initial[query] ?? false,
      media: query,
      addEventListener: options?.legacyOnly
        ? undefined
        : vi.fn((_type: string, listener: () => void) => {
            listeners.add(listener);
          }),
      removeEventListener: options?.legacyOnly
        ? undefined
        : vi.fn((_type: string, listener: () => void) => {
            listeners.delete(listener);
          }),
      addListener: vi.fn((listener: () => void) => {
        listeners.add(listener);
      }),
      removeListener: vi.fn((listener: () => void) => {
        listeners.delete(listener);
      }),
      setMatches(next: boolean) {
        mql.matches = next;
        for (const listener of listeners) listener();
      },
    };
    lists.set(query, mql);
    return mql;
  }

  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => getList(query)),
  );
  return { getList };
}

describe("useMediaQuery (CMO)", () => {
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

  function Probe({ query }: { query: string }) {
    const matches = useMediaQuery(query);
    return <span>{String(matches)}</span>;
  }

  it("reads the initial media query and updates live on change", async () => {
    const { getList } = stubMatchMedia({
      "(prefers-color-scheme: dark)": false,
    });

    await act(async () =>
      root.render(<Probe query="(prefers-color-scheme: dark)" />),
    );
    expect(container.textContent).toBe("false");

    const mql = getList("(prefers-color-scheme: dark)");
    await act(async () => {
      mql.setMatches(true);
    });
    expect(container.textContent).toBe("true");

    await act(async () => root.unmount());
    expect(mql.removeEventListener).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });

  it("falls back to addListener and removeListener when addEventListener is absent", async () => {
    const { getList } = stubMatchMedia(
      { "(prefers-color-scheme: dark)": false },
      { legacyOnly: true },
    );

    await act(async () =>
      root.render(<Probe query="(prefers-color-scheme: dark)" />),
    );
    const mql = getList("(prefers-color-scheme: dark)");
    expect(mql.addListener).toHaveBeenCalledTimes(1);

    await act(async () => {
      mql.setMatches(true);
    });
    expect(container.textContent).toBe("true");

    await act(async () => root.unmount());
    expect(mql.removeListener).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });

  it("preserves an explicit undefined serverSnapshot during SSR", () => {
    function UnresolvedProbe() {
      const matches = useMediaQuery("(prefers-color-scheme: dark)", undefined);
      return <span>{String(matches)}</span>;
    }

    expect(renderToString(<UnresolvedProbe />)).toBe("<span>undefined</span>");
  });
});
