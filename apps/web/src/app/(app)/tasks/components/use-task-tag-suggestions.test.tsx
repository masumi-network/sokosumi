import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskTagSuggestions } from "./use-task-tag-suggestions";

const suggestTaskTags = vi.fn<typeof fetch>();
const description =
  "Research the European market and write a detailed launch strategy for our new product";
const defaults = {
  name: "",
  description,
  workspaceKey: "user:org",
  enabled: true,
};
function success() {
  return Response.json({ tags: ["research"], receipt: "receipt-1" });
}
async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", suggestTaskTags);
  suggestTaskTags.mockReset().mockImplementation(async () => success());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("draft tag suggestions", () => {
  it("waits for meaningful input and a pause; punctuation-only changes do not spend again", async () => {
    const { result, rerender } = renderHook(useTaskTagSuggestions, {
      initialProps: { ...defaults, description: "Hello" },
    });
    await advance(5000);
    expect(suggestTaskTags).not.toHaveBeenCalled();
    rerender(defaults);
    await advance(1199);
    expect(suggestTaskTags).not.toHaveBeenCalled();
    await advance(1);
    expect(suggestTaskTags).toHaveBeenCalledTimes(1);
    expect(result.current.tagSuggestionReceipt).toBe("receipt-1");
    rerender({ ...defaults, description: `${description}!` });
    expect(result.current.tagSuggestionReceipt).toBeUndefined();
    expect(result.current.tags).toEqual(["research"]);
    await advance(10000);
    expect(suggestTaskTags).toHaveBeenCalledTimes(1);
  });

  it("keeps equivalent in-flight punctuation suggestions but withholds the changed-input receipt", async () => {
    let resolve!: (value: Response) => void;
    suggestTaskTags.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result, rerender } = renderHook(useTaskTagSuggestions, {
      initialProps: defaults,
    });
    await advance(1200);
    rerender({ ...defaults, description: `${description.toUpperCase()}!` });
    await act(async () => resolve(success()));
    expect(result.current.tags).toEqual(["research"]);
    expect(result.current.tagSuggestionReceipt).toBeUndefined();
    await advance(10000);
    expect(suggestTaskTags).toHaveBeenCalledOnce();
  });

  it("reuses the receipt across whitespace-only changes", async () => {
    const { result, rerender } = renderHook(useTaskTagSuggestions, {
      initialProps: defaults,
    });
    await advance(1200);
    rerender({ ...defaults, description: description.replaceAll(" ", "  ") });
    expect(result.current.tagSuggestionReceipt).toBe("receipt-1");
    await advance(10000);
    expect(suggestTaskTags).toHaveBeenCalledOnce();
  });

  it("ignores stale responses and serializes the next changed input after cooldown", async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(suggestTaskTags).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result, rerender } = renderHook(useTaskTagSuggestions, {
      initialProps: defaults,
    });
    await advance(1200);
    rerender({ ...defaults, description: `${description} and pricing` });
    await advance(1200);
    expect(suggestTaskTags).toHaveBeenCalledTimes(1);
    await act(async () => resolve(success()));
    expect(result.current.tags).toEqual([]);
    expect(result.current.tagSuggestionReceipt).toBeUndefined();
    await advance(8799);
    expect(suggestTaskTags).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(suggestTaskTags).toHaveBeenCalledTimes(2);
    expect(result.current.tags).toEqual(["research"]);
  });

  it("invalidates suggestions immediately when the workspace changes", async () => {
    const { result, rerender } = renderHook(useTaskTagSuggestions, {
      initialProps: defaults,
    });
    await advance(1200);
    expect(result.current.tags).toEqual(["research"]);
    rerender({ ...defaults, workspaceKey: "user:another-org" });
    expect(result.current.tags).toEqual([]);
    expect(result.current.tagSuggestionReceipt).toBeUndefined();
  });

  it("backs off failed requests without retrying unchanged content", async () => {
    vi.mocked(suggestTaskTags).mockResolvedValueOnce(
      Response.json({}, { status: 429, headers: { "Retry-After": "60" } }),
    );
    const { result, rerender } = renderHook(useTaskTagSuggestions, {
      initialProps: defaults,
    });
    await advance(1200);
    // Backoff still applies; the composer just never says anything about it.
    expect(result.current.status).toBeNull();
    await advance(120000);
    expect(suggestTaskTags).toHaveBeenCalledTimes(1);
    rerender({ ...defaults, description: `${description} including audience` });
    await advance(1200);
    expect(suggestTaskTags).toHaveBeenCalledTimes(2);
  });

  it("respects backoff for new input and rejects oversized input", async () => {
    vi.mocked(suggestTaskTags).mockResolvedValueOnce(
      Response.json({}, { status: 429, headers: { "Retry-After": "60" } }),
    );
    const { rerender } = renderHook(useTaskTagSuggestions, {
      initialProps: defaults,
    });
    await advance(1200);
    rerender({ ...defaults, description: `${description} including audience` });
    await advance(59999);
    expect(suggestTaskTags).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(suggestTaskTags).toHaveBeenCalledTimes(2);
    rerender({ ...defaults, description: "x".repeat(8001) });
    await advance(100000);
    expect(suggestTaskTags).toHaveBeenCalledTimes(2);
  });

  it("keeps a successful empty receipt reusable and stops requests after unmount", async () => {
    vi.mocked(suggestTaskTags).mockResolvedValue(
      Response.json({ tags: [], receipt: "empty-receipt" }),
    );
    const { result, unmount } = renderHook(useTaskTagSuggestions, {
      initialProps: defaults,
    });
    await advance(1200);
    expect(result.current.tags).toEqual([]);
    expect(result.current.tagSuggestionReceipt).toBe("empty-receipt");
    unmount();
    await advance(10000);
    expect(suggestTaskTags).toHaveBeenCalledTimes(1);
  });
  // Items 4/5: Patrick typed past 40 characters and saw nothing, because the gate
  // counted only letters and digits at a floor of 40 — roughly 50 typed characters.
  it("asks as soon as there are 15 letters or digits, and not before", async () => {
    // 14 letters: one short of the shared minimum.
    const { rerender } = renderHook(useTaskTagSuggestions, {
      initialProps: { ...defaults, description: "Write blog posts" },
    });
    await advance(30000);
    expect(suggestTaskTags).not.toHaveBeenCalled();
    // 15 letters, and well under the 40 the old gate demanded.
    rerender({ ...defaults, description: "Write blog postsx" });
    await advance(1200);
    expect(suggestTaskTags).toHaveBeenCalledTimes(1);
  });

  it("holds the lower gate to the per-user budget of six requests a minute", async () => {
    const { rerender } = renderHook(useTaskTagSuggestions, {
      initialProps: { ...defaults, description: "Draft the launch plan" },
    });
    // Keep typing new words for a minute, pausing long enough each time that the
    // debounce alone would let every one of them through.
    for (let index = 0; index < 30; index++) {
      rerender({
        ...defaults,
        description: `Draft the launch plan ${"word ".repeat(index + 1)}`,
      });
      await advance(2000);
    }
    expect(suggestTaskTags.mock.calls.length).toBeLessThanOrEqual(6);
    expect(suggestTaskTags.mock.calls.length).toBeGreaterThan(0);
  });

  // Item 3: a Gateway outage, a policy rejection, a timeout or a rate limit must
  // never reach the composer. Nothing is shown, nothing is thrown, no receipt is
  // produced, so the create goes ahead untagged and the cron tags the row later.
  it.each([
    { label: "a 5xx outage", make: () => Response.json({}, { status: 503 }) },
    {
      label: "a policy rejection",
      make: () => Response.json({}, { status: 403 }),
    },
    {
      label: "a rate limit",
      make: () =>
        Response.json({}, { status: 429, headers: { "Retry-After": "60" } }),
    },
  ])("shows nothing at all through $label", async ({ make }) => {
    vi.mocked(suggestTaskTags).mockResolvedValue(make());
    const { result } = renderHook(useTaskTagSuggestions, {
      initialProps: defaults,
    });
    await advance(1200);
    expect(suggestTaskTags).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBeNull();
    expect(result.current.tags).toEqual([]);
    expect(result.current.tagSuggestionReceipt).toBeUndefined();
  });

  it.each([
    {
      label: "an aborted request",
      error: () => new DOMException("The operation was aborted", "AbortError"),
    },
    {
      label: "a dropped connection",
      error: () => new TypeError("fetch failed"),
    },
  ])("shows nothing at all through $label", async ({ error }) => {
    vi.mocked(suggestTaskTags).mockRejectedValue(error());
    const { result } = renderHook(useTaskTagSuggestions, {
      initialProps: defaults,
    });
    await advance(1200);
    expect(result.current.status).toBeNull();
    expect(result.current.tags).toEqual([]);
    expect(result.current.tagSuggestionReceipt).toBeUndefined();
  });

  it("abandons a request the server never answers and shows nothing", async () => {
    vi.mocked(suggestTaskTags).mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted", "AbortError")),
          );
        }),
    );
    const { result } = renderHook(useTaskTagSuggestions, {
      initialProps: defaults,
    });
    await advance(1200);
    expect(result.current.status).toBe("loading");
    await advance(15000);
    expect(result.current.status).toBeNull();
    expect(result.current.tags).toEqual([]);
    expect(result.current.tagSuggestionReceipt).toBeUndefined();
  });
});
