import type { Coworker } from "@sokosumi/core-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getCoworkersMock } = vi.hoisted(() => ({
  getCoworkersMock: vi.fn(),
}));

vi.mock("@sokosumi/core-client", () => ({
  getCoworkers: (...args: unknown[]) => getCoworkersMock(...args),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => ({}),
}));

import { useDriveTasksFilterCoworkers } from "./use-drive-tasks-filter-coworkers";

const COWORKER = {
  id: "cw-1",
  name: "Alex",
  slug: "alex",
} as Coworker;

describe("useDriveTasksFilterCoworkers", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("loads coworkers and reloads when activeOrganizationId changes, falling back to empty on error", async () => {
    getCoworkersMock
      .mockResolvedValueOnce({ data: { data: [COWORKER] } })
      .mockRejectedValueOnce(new Error("offline"));

    const { result, rerender } = renderHook(
      ({ orgId }) => useDriveTasksFilterCoworkers(orgId),
      { initialProps: { orgId: null as string | null } },
    );

    await waitFor(() => expect(result.current).toEqual([COWORKER]));

    rerender({ orgId: "org-1" });
    await waitFor(() => expect(result.current).toEqual([]));
    expect(getCoworkersMock).toHaveBeenCalledTimes(2);
  });

  it("ignores a late response after unmount", async () => {
    const pending = Promise.withResolvers<{ data: { data: Coworker[] } }>();
    getCoworkersMock.mockReturnValueOnce(pending.promise);

    const { result, unmount } = renderHook(() =>
      useDriveTasksFilterCoworkers(null),
    );
    unmount();

    await act(async () => {
      pending.resolve({ data: { data: [COWORKER] } });
      await pending.promise;
    });
    expect(result.current).toEqual([]);
  });
});
