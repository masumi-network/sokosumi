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
    await advance(3799);
    expect(suggestTaskTags).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(suggestTaskTags).toHaveBeenCalledTimes(2);
    expect(result.current.tags).toEqual(["research"]);
  });

  it("invalidates suggestions and manual changes immediately when workspace changes", async () => {
    const { result, rerender } = renderHook(useTaskTagSuggestions, {
      initialProps: defaults,
    });
    await advance(1200);
    act(() => result.current.toggleTag("design", true));
    rerender({ ...defaults, workspaceKey: "user:another-org" });
    expect(result.current.tags).toEqual([]);
    expect(result.current.tagSuggestionReceipt).toBeUndefined();
    expect(result.current.tagCorrections).toBeUndefined();
  });

  it("keeps manual choices and rejected suggestions across refreshed results", async () => {
    const { result, rerender } = renderHook(useTaskTagSuggestions, {
      initialProps: defaults,
    });
    await advance(1200);
    act(() => {
      result.current.toggleTag("research", false);
      result.current.toggleTag("design", true);
    });
    rerender({ ...defaults, description: `${description} and pricing` });
    await advance(5000);
    expect(result.current.tags).toEqual(["design"]);
    expect(result.current.tagCorrections).toEqual({
      add: ["design"],
      remove: ["research"],
    });
  });

  it("backs off failed requests without retrying unchanged content", async () => {
    vi.mocked(suggestTaskTags).mockResolvedValueOnce(
      Response.json({}, { status: 429, headers: { "Retry-After": "60" } }),
    );
    const { result, rerender } = renderHook(useTaskTagSuggestions, {
      initialProps: defaults,
    });
    await advance(1200);
    expect(result.current.status).toBe("unavailable");
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
});
