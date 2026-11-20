import { act, renderHook } from "@testing-library/react";
import {
  type UrlUpdateEvent,
  withNuqsTestingAdapter,
} from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

import useGalleryFilter from "./use-gallery-filter";

describe("useGalleryFilter", () => {
  it("still filters by an old agentQuery link", () => {
    const { result } = renderHook(() => useGalleryFilter(), {
      wrapper: withNuqsTestingAdapter({ searchParams: "?agentQuery=research" }),
    });

    expect(result.current.query).toBe("research");
  });

  it("moves an old agentQuery link to query on the next search", async () => {
    const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
    const { result } = renderHook(() => useGalleryFilter(), {
      wrapper: withNuqsTestingAdapter({
        searchParams: "?agentQuery=research",
        onUrlUpdate,
      }),
    });

    await act(() => result.current.setQuery("news"));

    const last = onUrlUpdate.mock.calls.at(-1)?.[0];
    expect(last?.searchParams.get("query")).toBe("news");
    expect(last?.searchParams.has("agentQuery")).toBe(false);
    expect(result.current.query).toBe("news");
  });

  it("prefers query when a link carries both", () => {
    const { result } = renderHook(() => useGalleryFilter(), {
      wrapper: withNuqsTestingAdapter({
        searchParams: "?query=news&agentQuery=research",
      }),
    });

    expect(result.current.query).toBe("news");
  });
});
