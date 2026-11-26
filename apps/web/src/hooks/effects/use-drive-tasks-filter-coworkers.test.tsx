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

  it("drops workspace A coworkers immediately on switch and ignores a late workspace A response under workspace B", async () => {
    const coworkerA = { id: "cw-a", name: "Alice", slug: "alice" } as Coworker;
    const coworkerB = { id: "cw-b", name: "Bob", slug: "bob" } as Coworker;
    const orgAPending = Promise.withResolvers<{ data: { data: Coworker[] } }>();
    const orgBPending = Promise.withResolvers<{ data: { data: Coworker[] } }>();
    let orgASignal: AbortSignal | undefined;

    getCoworkersMock
      .mockResolvedValueOnce({ data: { data: [coworkerA] } })
      .mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
        orgASignal = signal;
        return orgAPending.promise;
      })
      .mockImplementationOnce(() => orgBPending.promise);

    // Start in org-a with loaded coworkers, then verify switching clears immediately.
    const { result, rerender } = renderHook(
      ({ orgId }) => useDriveTasksFilterCoworkers(orgId),
      { initialProps: { orgId: "org-a" as string | null } },
    );

    await waitFor(() => expect(result.current).toEqual([coworkerA]));

    // Switch to personal workspace (in-flight) -> org-a coworkers disappear immediately.
    rerender({ orgId: null });
    expect(result.current).toEqual([]);

    // Switch to org-b while the previous workspace request is still pending.
    rerender({ orgId: "org-b" });
    expect(orgASignal?.aborted).toBe(true);
    expect(result.current).toEqual([]);

    // Late response from the previous workspace must never appear under org-b.
    await act(async () => {
      orgAPending.resolve({ data: { data: [coworkerA] } });
      await orgAPending.promise;
    });
    expect(result.current).toEqual([]);

    await act(async () => {
      orgBPending.resolve({ data: { data: [coworkerB] } });
      await orgBPending.promise;
    });
    expect(result.current).toEqual([coworkerB]);
  });
});
