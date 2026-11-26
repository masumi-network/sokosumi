import type { FileResource } from "@sokosumi/core-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchFileResourceMock, fetchRelatedFilesMock } = vi.hoisted(() => ({
  fetchFileResourceMock: vi.fn(),
  fetchRelatedFilesMock: vi.fn(),
}));

vi.mock("@/lib/utils/file-search.client", () => ({
  fetchFileResource: (...args: unknown[]) => fetchFileResourceMock(...args),
  fetchRelatedFiles: (...args: unknown[]) => fetchRelatedFilesMock(...args),
}));

import { useDriveFileDetail } from "./use-drive-file-detail";

const ME_STORE = { scope: "me" as const };
const ORG_STORE = { scope: "org" as const, organizationId: "org-1" };

const FILE = {
  id: "res-1",
  displayName: "brief.pdf",
  mimeType: "application/pdf",
  sizeBytes: 2048,
  metadataRevision: 1,
  sourceKind: "DRIVE_UPLOAD",
  extractionState: "INDEXED",
  extractionCoverage: 1,
  extractionReason: null,
  category: null,
  tags: [],
  rejected: [],
  suggestions: [],
  projects: [],
} as unknown as FileResource;

const RELATED = {
  id: "res-2",
  displayName: "notes.md",
} as unknown as FileResource;

describe("useDriveFileDetail", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("waits while sessionPending is true, then loads resource and related files with an AbortSignal", async () => {
    fetchFileResourceMock.mockResolvedValueOnce(FILE);
    fetchRelatedFilesMock.mockResolvedValueOnce({
      items: [RELATED],
      state: "ok",
    });

    const { result, rerender } = renderHook(
      ({ sessionPending }) =>
        useDriveFileDetail({
          resourceId: "res-1",
          store: ME_STORE,
          sessionPending,
        }),
      { initialProps: { sessionPending: true } },
    );

    expect(fetchFileResourceMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);

    rerender({ sessionPending: false });

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.related).toEqual([RELATED]));
    expect(result.current.resource).toEqual(FILE);
    expect(result.current.unavailable).toBe(false);
    expect(result.current.relatedState).toBe("ok");
    expect(fetchFileResourceMock).toHaveBeenCalledWith({
      store: ME_STORE,
      resourceId: "res-1",
      signal: expect.any(AbortSignal),
    });
    expect(fetchRelatedFilesMock).toHaveBeenCalledWith({
      store: ME_STORE,
      resourceId: "res-1",
      signal: expect.any(AbortSignal),
    });
  });

  it("aborts in-flight requests on unmount and ignores late rejections", async () => {
    const pending = Promise.withResolvers<FileResource>();
    let capturedSignal: AbortSignal | undefined;
    fetchFileResourceMock.mockImplementationOnce(
      (input: { signal?: AbortSignal }) => {
        capturedSignal = input.signal;
        return pending.promise;
      },
    );

    const { result, unmount } = renderHook(() =>
      useDriveFileDetail({
        resourceId: "res-1",
        store: ME_STORE,
        sessionPending: false,
      }),
    );

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);

    await act(async () => {
      pending.reject(new DOMException("Aborted", "AbortError"));
      await pending.promise.catch(() => {});
    });

    expect(result.current.unavailable).toBe(false);
    expect(fetchRelatedFilesMock).not.toHaveBeenCalled();
  });

  it("aborts an earlier store load so a stale 404 cannot overwrite a newer store response", async () => {
    const mePending = Promise.withResolvers<FileResource>();
    let meSignal: AbortSignal | undefined;
    fetchFileResourceMock
      .mockImplementationOnce((input: { signal?: AbortSignal }) => {
        meSignal = input.signal;
        return mePending.promise;
      })
      .mockResolvedValueOnce(FILE);
    fetchRelatedFilesMock.mockResolvedValueOnce({ items: [], state: "ok" });

    const { result, rerender } = renderHook(
      ({ store }) =>
        useDriveFileDetail({
          resourceId: "res-1",
          store,
          sessionPending: false,
        }),
      {
        initialProps: {
          store: ME_STORE as
            | { scope: "me" }
            | { scope: "org"; organizationId: string },
        },
      },
    );

    rerender({ store: ORG_STORE });
    expect(meSignal?.aborted).toBe(true);

    await waitFor(() => expect(result.current.resource).toEqual(FILE));

    await act(async () => {
      mePending.reject(new Error("404"));
      await mePending.promise.catch(() => {});
    });

    expect(result.current.unavailable).toBe(false);
    expect(result.current.resource).toEqual(FILE);
  });

  it("marks unavailable when resource fetch fails and supports reload", async () => {
    fetchFileResourceMock
      .mockRejectedValueOnce(new Error("Not found"))
      .mockResolvedValueOnce(FILE);
    fetchRelatedFilesMock.mockResolvedValueOnce({ items: [], state: "ok" });

    const { result } = renderHook(() =>
      useDriveFileDetail({
        resourceId: "res-1",
        store: ME_STORE,
        sessionPending: false,
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.unavailable).toBe(true);
    expect(fetchRelatedFilesMock).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.unavailable).toBe(false);
    expect(result.current.resource).toEqual(FILE);
  });
});
