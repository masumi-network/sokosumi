import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.search.current,
}));

import { SCOPE_VARIANT_STORAGE_KEY } from "./scope-variants";
import {
  storeScopeVariant,
  useScopeVariant,
  useScopeVariantOptedIn,
} from "./use-scope-variant";

function blockStorage() {
  vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  });
  expect(() => window.sessionStorage).toThrow();
}

beforeEach(() => {
  mocks.search.current = new URLSearchParams();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useScopeVariant", () => {
  it("is current with neither a URL param nor a stored choice", () => {
    const { result } = renderHook(() => useScopeVariant());

    expect(result.current).toBe("current");
  });

  it("uses the stored choice when the URL has none", () => {
    sessionStorage.setItem(SCOPE_VARIANT_STORAGE_KEY, "hub");

    const { result } = renderHook(() => useScopeVariant());

    expect(result.current).toBe("hub");
  });

  it("lets the URL param win over the stored choice", () => {
    sessionStorage.setItem(SCOPE_VARIANT_STORAGE_KEY, "hub");
    mocks.search.current = new URLSearchParams("variant=header");

    const { result } = renderHook(() => useScopeVariant());

    expect(result.current).toBe("header");
  });

  it("falls back to the stored choice for an unknown URL param", () => {
    sessionStorage.setItem(SCOPE_VARIANT_STORAGE_KEY, "command");
    mocks.search.current = new URLSearchParams("variant=bogus");

    const { result } = renderHook(() => useScopeVariant());

    expect(result.current).toBe("command");
  });

  it("follows storeScopeVariant without a navigation", () => {
    const { result } = renderHook(() => useScopeVariant());
    expect(result.current).toBe("current");

    act(() => storeScopeVariant("combined"));

    expect(result.current).toBe("combined");
    expect(sessionStorage.getItem(SCOPE_VARIANT_STORAGE_KEY)).toBe("combined");
  });

  it("reads current when storage is blocked", () => {
    blockStorage();

    const { result } = renderHook(() => useScopeVariant());

    expect(result.current).toBe("current");
  });

  it("still reads the URL param when storage is blocked", () => {
    blockStorage();
    mocks.search.current = new URLSearchParams("variant=sidebar");

    const { result } = renderHook(() => useScopeVariant());

    expect(result.current).toBe("sidebar");
  });
});

describe("useScopeVariantOptedIn", () => {
  it("is false with neither a URL param nor a stored choice", () => {
    const { result } = renderHook(() => useScopeVariantOptedIn());

    expect(result.current).toBe(false);
  });

  it("is true with a URL param", () => {
    mocks.search.current = new URLSearchParams("variant=current");

    const { result } = renderHook(() => useScopeVariantOptedIn());

    expect(result.current).toBe(true);
  });

  it("is true with a stored choice", () => {
    sessionStorage.setItem(SCOPE_VARIANT_STORAGE_KEY, "current");

    const { result } = renderHook(() => useScopeVariantOptedIn());

    expect(result.current).toBe(true);
  });

  it("is false for an unknown URL param", () => {
    mocks.search.current = new URLSearchParams("variant=bogus");

    const { result } = renderHook(() => useScopeVariantOptedIn());

    expect(result.current).toBe(false);
  });
});

describe("storeScopeVariant", () => {
  it("notifies subscribers", () => {
    const listener = vi.fn();
    const { result } = renderHook(() => useScopeVariantOptedIn());
    window.addEventListener("sok-1202-scope-variant-change", listener);

    act(() => storeScopeVariant("hub"));

    window.removeEventListener("sok-1202-scope-variant-change", listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(true);
  });

  it("does not throw when storage is blocked, and still notifies", () => {
    blockStorage();
    const listener = vi.fn();
    window.addEventListener("sok-1202-scope-variant-change", listener);

    expect(() => storeScopeVariant("hub")).not.toThrow();

    window.removeEventListener("sok-1202-scope-variant-change", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
