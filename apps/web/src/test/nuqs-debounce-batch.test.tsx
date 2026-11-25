import { act, render } from "@testing-library/react";
import { debounce, parseAsString, useQueryStates } from "nuqs";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

const PARAMS = {
  search: parseAsString.withDefault(""),
  status: parseAsString,
  cursor: parseAsString,
};

describe("nuqs debounced multi-key updates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("flushes keys debounced in the same update atomically even across a timer tick boundary", async () => {
    const updates: UrlUpdateEvent[] = [];
    let setQuery!: ReturnType<typeof useQueryStates<typeof PARAMS>>[1];

    function Harness() {
      const [, update] = useQueryStates(PARAMS);
      setQuery = update;
      return null;
    }

    render(
      <NuqsTestingAdapter
        searchParams="?cursor=s1&status=ACTIVE"
        onUrlUpdate={(event) => updates.push(event)}
        hasMemory
      >
        <Harness />
      </NuqsTestingAdapter>,
    );

    // Simulate a 1ms OS/libuv timer bucket tick landing between per-key
    // setTimeout registrations by delaying any second 20ms timer in the same call.
    const realSetTimeout = globalThis.setTimeout;
    let debounceTimerCount = 0;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay === 20) {
        debounceTimerCount += 1;
        const effectiveDelay = debounceTimerCount > 1 ? 25 : 20;
        return realSetTimeout(callback, effectiveDelay, ...args);
      }
      return realSetTimeout(callback, delay, ...args);
    }) as typeof setTimeout);

    await act(async () => {
      await setQuery(
        { search: "example.com", cursor: null },
        { limitUrlUpdates: debounce(20) },
      );
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]?.searchParams.get("search")).toBe("example.com");
    expect(updates[0]?.searchParams.get("status")).toBe("ACTIVE");
    expect(updates[0]?.searchParams.has("cursor")).toBe(false);
  });

  it("still aborts an individual debounced key when overridden before flush", async () => {
    const updates: UrlUpdateEvent[] = [];
    let setQuery!: ReturnType<typeof useQueryStates<typeof PARAMS>>[1];

    function Harness() {
      const [, update] = useQueryStates(PARAMS);
      setQuery = update;
      return null;
    }

    render(
      <NuqsTestingAdapter
        searchParams="?cursor=s1&status=ACTIVE"
        onUrlUpdate={(event) => updates.push(event)}
        hasMemory
      >
        <Harness />
      </NuqsTestingAdapter>,
    );

    let debouncedPromise!: Promise<URLSearchParams>;
    act(() => {
      debouncedPromise = setQuery(
        { search: "example.com", cursor: null },
        { limitUrlUpdates: debounce(30) },
      );
    });

    await act(async () => {
      await setQuery({ cursor: "s2" });
    });

    await act(async () => {
      await debouncedPromise;
    });

    const last = updates.at(-1)?.searchParams;
    expect(last?.get("search")).toBe("example.com");
    expect(last?.get("cursor")).toBe("s2");
  });
});
