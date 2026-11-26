import type { DriveShare } from "@sokosumi/core-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchDriveShareMock, toastErrorMock } = vi.hoisted(() => ({
  fetchDriveShareMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/lib/utils/file-search.client", () => ({
  fetchDriveShare: (...args: unknown[]) => fetchDriveShareMock(...args),
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastErrorMock(...args) },
}));

import { useDriveShareLoader } from "./use-drive-share-loader";

const STORE = { scope: "me" as const };
const ITEM = {
  target: { kind: "file" as const, resourceId: "res-1" },
  name: "brief.pdf",
};
const SHARE = {
  id: "share-1",
  token: "tok-1",
  hasPassword: false,
} as DriveShare;

describe("useDriveShareLoader", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("loads the share for item, resets password on item change, and reads loadFailedMessage through the caller ref", async () => {
    fetchDriveShareMock.mockResolvedValue(SHARE);
    const loadFailedMessage = { current: "Failed" };

    const { result, rerender } = renderHook(
      ({ item }) => useDriveShareLoader(item, STORE, loadFailedMessage),
      { initialProps: { item: ITEM as typeof ITEM | null } },
    );

    await waitFor(() => expect(result.current.share).toEqual(SHARE));
    expect(fetchDriveShareMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setPassword("secret");
    });
    expect(result.current.password).toBe("secret");

    loadFailedMessage.current = "Updated failure message";
    rerender({ item: ITEM });
    expect(fetchDriveShareMock).toHaveBeenCalledTimes(1);

    const nextItem = {
      target: { kind: "file" as const, resourceId: "res-2" },
      name: "notes.md",
    };
    fetchDriveShareMock.mockResolvedValueOnce(null);
    rerender({ item: nextItem });

    await waitFor(() => expect(result.current.share).toBeNull());
    expect(result.current.password).toBe("");
    expect(fetchDriveShareMock).toHaveBeenCalledTimes(2);
  });

  it("toasts loadFailedMessage.current and falls back to null when loading fails", async () => {
    fetchDriveShareMock.mockRejectedValueOnce(new Error("boom"));
    const loadFailedMessage = { current: "Could not load link" };

    const { result } = renderHook(() =>
      useDriveShareLoader(ITEM, STORE, loadFailedMessage),
    );

    await waitFor(() => expect(result.current.share).toBeNull());
    expect(toastErrorMock).toHaveBeenCalledWith("Could not load link");
  });

  it("aborts the in-flight request on unmount and suppresses late failure toasts", async () => {
    const pending = Promise.withResolvers<DriveShare | null>();
    let capturedSignal: AbortSignal | undefined;
    fetchDriveShareMock.mockImplementationOnce(
      (input: { signal?: AbortSignal }) => {
        capturedSignal = input.signal;
        return pending.promise;
      },
    );
    const loadFailedMessage = { current: "Could not load link" };

    const { unmount } = renderHook(() =>
      useDriveShareLoader(ITEM, STORE, loadFailedMessage),
    );

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);

    await act(async () => {
      pending.reject(new Error("aborted"));
      await pending.promise.catch(() => {});
    });

    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
