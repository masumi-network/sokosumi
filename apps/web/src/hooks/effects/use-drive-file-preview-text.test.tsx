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
    );
  });

  it("transitions to failed on non-ok responses and ignores late responses after unmount", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("nope", { status: 500 }),
    );

    const { result } = renderHook(() =>
      useDriveFilePreviewText(true, "/api/drive/files/r2/content?scope=me"),
    );

    await waitFor(() => expect(result.current).toEqual({ kind: "failed" }));

    const pending = Promise.withResolvers<Response>();
    vi.spyOn(globalThis, "fetch").mockReturnValueOnce(pending.promise);

    const mounted = renderHook(() =>
      useDriveFilePreviewText(true, "/api/drive/files/r3/content?scope=me"),
    );
    mounted.unmount();

    await act(async () => {
      pending.resolve(new Response("stale", { status: 200 }));
      await pending.promise;
    });
    expect(mounted.result.current).toEqual({ kind: "loading" });
  });
});
