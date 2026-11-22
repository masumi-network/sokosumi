import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDeferredPromise } from "./use-deferred-promise";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useDeferredPromise", () => {
  it("returns undefined while pending and updates when the promise fulfills", async () => {
    const d = deferred<string>();
    const { result } = renderHook(() => useDeferredPromise(d.promise, "fail"));

    expect(result.current).toBeUndefined();

    await act(async () => {
      d.resolve("ready");
      await d.promise;
    });

    expect(result.current).toBe("ready");
  });

  it("distinguishes a fulfilled null value from pending undefined", async () => {
    const d = deferred<string | null>();
    const { result } = renderHook(() => useDeferredPromise(d.promise, "fail"));

    expect(result.current).toBeUndefined();

    await act(async () => {
      d.resolve(null);
      await d.promise;
    });

    expect(result.current).toBeNull();
  });

  it("returns fallbackOnReject when the promise rejects", async () => {
    const d = deferred<string>();
    const { result } = renderHook(() =>
      useDeferredPromise(d.promise, "fallback"),
    );

    await act(async () => {
      d.reject(new Error("boom"));
      await d.promise.catch(() => {});
    });

    expect(result.current).toBe("fallback");
  });

  it("ignores an older promise that settles after the prop swaps", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const { result, rerender } = renderHook(
      ({ promise }: { promise: Promise<string> | undefined }) =>
        useDeferredPromise(promise, "fallback"),
      {
        initialProps: { promise: first.promise as Promise<string> | undefined },
      },
    );

    rerender({ promise: second.promise });
    expect(result.current).toBeUndefined();

    await act(async () => {
      first.resolve("stale");
      await first.promise;
    });
    expect(result.current).toBeUndefined();

    await act(async () => {
      second.resolve("fresh");
      await second.promise;
    });
    expect(result.current).toBe("fresh");

    rerender({ promise: undefined });
    expect(result.current).toBeUndefined();
  });
});
