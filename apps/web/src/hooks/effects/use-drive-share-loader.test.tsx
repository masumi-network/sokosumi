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

  it("loads the share for item, resets password on item change, and does not refetch when loadFailedText changes", async () => {
    fetchDriveShareMock.mockResolvedValue(SHARE);

    const { result, rerender } = renderHook(
      ({ item, text }) => useDriveShareLoader(item, STORE, text),
      { initialProps: { item: ITEM as typeof ITEM | null, text: "Failed" } },
    );

    await waitFor(() => expect(result.current.share).toEqual(SHARE));
    expect(fetchDriveShareMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setPassword("secret");
    });
    expect(result.current.password).toBe("secret");

    rerender({ item: ITEM, text: "Updated failure message" });
    expect(fetchDriveShareMock).toHaveBeenCalledTimes(1);

    const nextItem = {
      target: { kind: "file" as const, resourceId: "res-2" },
      name: "notes.md",
    };
    fetchDriveShareMock.mockResolvedValueOnce(null);
    rerender({ item: nextItem, text: "Updated failure message" });

    await waitFor(() => expect(result.current.share).toBeNull());
    expect(result.current.password).toBe("");
    expect(fetchDriveShareMock).toHaveBeenCalledTimes(2);
  });

  it("toasts loadFailedText and falls back to null when loading fails", async () => {
    fetchDriveShareMock.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() =>
      useDriveShareLoader(ITEM, STORE, "Could not load link"),
    );

    await waitFor(() => expect(result.current.share).toBeNull());
    expect(toastErrorMock).toHaveBeenCalledWith("Could not load link");
  });
});
