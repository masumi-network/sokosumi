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
    expect(result.current.catalogQuery).toBe("research");
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

  it("keeps both old filters from a link that carries both keys", () => {
    const { result } = renderHook(() => useGalleryFilter(), {
      wrapper: withNuqsTestingAdapter({
        searchParams: "?query=news&agentQuery=research",
      }),
    });

    // Before the single search, `query` searched coworkers and offers and
    // `agentQuery` the catalog; the link opens as it did then.
    expect(result.current.query).toBe("news");
    expect(result.current.catalogQuery).toBe("research");
  });

  it("joins both filters into one search on the next edit", async () => {
    const { result } = renderHook(() => useGalleryFilter(), {
      wrapper: withNuqsTestingAdapter({
        searchParams: "?query=news&agentQuery=research",
      }),
    });

    await act(() => result.current.setQuery("news web"));

    expect(result.current.query).toBe("news web");
    expect(result.current.catalogQuery).toBe("news web");
  });
});
