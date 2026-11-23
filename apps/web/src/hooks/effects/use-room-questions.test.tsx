import type { DataRoomViewerQuestion } from "@sokosumi/core-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRoomQuestions } from "@/hooks/effects/use-room-questions";

function makeQuestion(id: string): DataRoomViewerQuestion {
  return {
    id,
    createdAt: "2026-11-17T10:00:00.000Z",
    path: "Introduction/Deck.pdf",
    body: `Question ${id}?`,
    answer: `Answer ${id}.`,
    answeredAt: "2026-11-17T11:00:00.000Z",
    mine: false,
    shared: true,
  };
}

describe("useRoomQuestions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads questions on mount without cache override on the initial request", async () => {
    const question = makeQuestion("q-1");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [question],
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useRoomQuestions("/share/rooms/tok/questions"),
    );

    expect(result.current.status).toBe("loading");

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    expect(result.current.questions).toEqual([question]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/share/rooms/tok/questions",
      undefined,
    );
  });

  it("marks failed on error and retries with cache: no-store", async () => {
    const question = makeQuestion("q-2");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [question],
      });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useRoomQuestions("/share/rooms/tok/questions"),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("failed");
    });

    act(() => {
      result.current.retry();
    });

    expect(result.current.status).toBe("loading");

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    expect(result.current.questions).toEqual([question]);
    expect(fetchMock).toHaveBeenLastCalledWith("/share/rooms/tok/questions", {
      cache: "no-store",
    });
  });

  it("refetches when url changes and ignores stale responses", async () => {
    let resolveFirst!: (value: unknown) => void;
    const stale = makeQuestion("q-stale");
    const fresh = makeQuestion("q-fresh");

    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [fresh],
      });
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender, unmount } = renderHook(
      ({ url }: { url: string }) => useRoomQuestions(url),
      { initialProps: { url: "/share/rooms/tok/questions?resourceId=1" } },
    );

    rerender({ url: "/share/rooms/tok/questions?resourceId=2" });

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.questions).toEqual([fresh]);

    await act(async () => {
      resolveFirst({ ok: true, json: async () => [stale] });
      await Promise.resolve();
    });

    expect(result.current.questions).toEqual([fresh]);

    unmount();
  });
});
