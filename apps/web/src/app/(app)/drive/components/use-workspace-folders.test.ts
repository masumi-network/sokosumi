import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const fetchWorkspaceFoldersMock = vi.fn();

vi.mock("@/lib/utils/file-search.client", () => ({
  fetchWorkspaceFolders: (...args: unknown[]) =>
    fetchWorkspaceFoldersMock(...args),
}));

import { useWorkspaceFolders } from "./use-workspace-folders";

const STORE = { scope: "me" as const };

describe("useWorkspaceFolders", () => {
  it("loads the folders again when the reload token changes", async () => {
    fetchWorkspaceFoldersMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["Launch", "Launch/Copy"]);

    const { result, rerender } = renderHook(
      ({ token }) => useWorkspaceFolders(STORE, token),
      { initialProps: { token: 0 } },
    );
    await waitFor(() =>
      expect(fetchWorkspaceFoldersMock).toHaveBeenCalledTimes(1),
    );
    expect(result.current).toEqual([]);

    // An upload just made `Launch` and its subfolder.
    rerender({ token: 1 });
    await waitFor(() =>
      expect(result.current).toEqual(["Launch", "Launch/Copy"]),
    );
  });

  it("shows no folders when the load fails", async () => {
    fetchWorkspaceFoldersMock.mockRejectedValueOnce(new Error("down"));
    const { result } = renderHook(() => useWorkspaceFolders(STORE, 0));
    await waitFor(() => expect(fetchWorkspaceFoldersMock).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
