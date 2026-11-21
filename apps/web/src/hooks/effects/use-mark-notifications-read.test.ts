import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { patchNotificationsReadMock, refetchMock, optionalNotificationsMock } =
  vi.hoisted(() => ({
    patchNotificationsReadMock: vi.fn(),
    refetchMock: vi.fn(),
    optionalNotificationsMock: vi.fn(),
  }));

vi.mock("@/lib/clients/core.notifications.browser.client", () => ({
  notificationsBrowserClient: {
    patchNotificationsRead: patchNotificationsReadMock,
  },
}));

vi.mock("@/contexts/notification-provider", () => ({
  useOptionalNotifications: () => optionalNotificationsMock(),
}));

import { useMarkNotificationsRead } from "./use-mark-notifications-read";

describe("useMarkNotificationsRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patchNotificationsReadMock.mockResolvedValue({ data: { count: 1 } });
    refetchMock.mockResolvedValue(undefined);
    optionalNotificationsMock.mockReturnValue({ refetch: refetchMock });
  });

  it("patches notifications read and refetches the bell when count > 0", async () => {
    renderHook(() => useMarkNotificationsRead("TASK", "task-1"));

    await waitFor(() => {
      expect(patchNotificationsReadMock).toHaveBeenCalledWith({
        kind: "TASK",
        referenceId: "task-1",
      });
      expect(refetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("skips refetch when count is 0 and re-runs only when kind or referenceId changes", async () => {
    patchNotificationsReadMock.mockResolvedValue({ data: { count: 0 } });
    const nextRefetch = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ kind, referenceId }: { kind: "TASK" | "JOB"; referenceId: string }) =>
        useMarkNotificationsRead(kind, referenceId),
      { initialProps: { kind: "TASK" as const, referenceId: "task-1" } },
    );

    await waitFor(() =>
      expect(patchNotificationsReadMock).toHaveBeenCalledTimes(1),
    );
    expect(refetchMock).not.toHaveBeenCalled();

    optionalNotificationsMock.mockReturnValue({ refetch: nextRefetch });
    rerender({ kind: "TASK", referenceId: "task-1" });
    expect(patchNotificationsReadMock).toHaveBeenCalledTimes(1);

    patchNotificationsReadMock.mockResolvedValue({ data: { count: 2 } });
    rerender({ kind: "TASK", referenceId: "task-2" });
    await waitFor(() => {
      expect(patchNotificationsReadMock).toHaveBeenLastCalledWith({
        kind: "TASK",
        referenceId: "task-2",
      });
      expect(nextRefetch).toHaveBeenCalledTimes(1);
    });
  });

  it("still refreshes the bell when unmounted before the patch resolves", async () => {
    const deferred = Promise.withResolvers<{ data: { count: number } }>();
    patchNotificationsReadMock.mockReturnValue(deferred.promise);

    const { unmount } = renderHook(() =>
      useMarkNotificationsRead("JOB", "job-1"),
    );

    await waitFor(() =>
      expect(patchNotificationsReadMock).toHaveBeenCalledTimes(1),
    );
    unmount();
    deferred.resolve({ data: { count: 1 } });

    await waitFor(() => expect(refetchMock).toHaveBeenCalledTimes(1));
  });
});
