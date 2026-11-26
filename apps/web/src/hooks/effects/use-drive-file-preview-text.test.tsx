import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDriveFilePreviewText } from "./use-drive-file-preview-text";

describe("useDriveFilePreviewText", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips fetching when isText is false and loads text when it becomes true", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("# Hello", { status: 200 }));

    const { result, rerender } = renderHook(
      ({ isText, source }) => useDriveFilePreviewText(isText, source),
      {
        initialProps: {
          isText: false,
          source: "/api/drive/files/r1/content?scope=me",
        },
      },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current).toEqual({ kind: "loading" });

    rerender({
      isText: true,
      source: "/api/drive/files/r1/content?scope=me",
    });

    await waitFor(() =>
      expect(result.current).toEqual({ kind: "ready", text: "# Hello" }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/drive/files/r1/content?scope=me",
      { signal: expect.any(AbortSignal) },
    );
  });

  it("transitions to failed on non-ok responses and aborts in-flight fetch on unmount", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("nope", { status: 500 }),
    );

    const { result } = renderHook(() =>
      useDriveFilePreviewText(true, "/api/drive/files/r2/content?scope=me"),
    );

    await waitFor(() => expect(result.current).toEqual({ kind: "failed" }));

    const pending = Promise.withResolvers<Response>();
    let capturedSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementationOnce((_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return pending.promise;
    });

    const mounted = renderHook(() =>
      useDriveFilePreviewText(true, "/api/drive/files/r3/content?scope=me"),
    );
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    mounted.unmount();
    expect(capturedSignal?.aborted).toBe(true);

    await act(async () => {
      pending.reject(new DOMException("Aborted", "AbortError"));
      await pending.promise.catch(() => {});
    });
    expect(mounted.result.current).toEqual({ kind: "loading" });
  });
});
