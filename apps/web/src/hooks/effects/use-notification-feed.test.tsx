import type { NotificationItem } from "@sokosumi/core-client";
import { expectConsole } from "@sokosumi/utils/test-console";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNotificationFeed } from "@/hooks/effects/use-notification-feed";

const getNotificationsMock = vi.fn();
const getNotificationsCountsMock = vi.fn();
const patchNotificationReadMock = vi.fn();
const patchNotificationUnreadMock = vi.fn();
const patchNotificationsReadAllMock = vi.fn();

vi.mock("@/lib/clients/core.notifications.browser.client", () => ({
  notificationsBrowserClient: {
    getNotifications: (...args: unknown[]) => getNotificationsMock(...args),
    getNotificationsCounts: (...args: unknown[]) =>
      getNotificationsCountsMock(...args),
    patchNotificationRead: (...args: unknown[]) =>
      patchNotificationReadMock(...args),
    patchNotificationUnread: (...args: unknown[]) =>
      patchNotificationUnreadMock(...args),
    patchNotificationsReadAll: (...args: unknown[]) =>
      patchNotificationsReadAllMock(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    dismiss: vi.fn(),
    getToasts: vi.fn(() => []),
  },
}));

function makeNotification(
  id: string,
  overrides: Partial<NotificationItem> = {},
): NotificationItem {
  return {
    id,
    userId: "user-1",
    kind: "JOB",
    referenceId: "job-1",
    eventId: "event-1",
    messageKey: "Notifications.Job.completed",
    messageParams: {},
    metadata: null,
    isRead: false,
    readAt: null,
    createdAt: new Date("2026-06-18T09:00:00.000Z"),
    ...overrides,
  };
}

describe("useNotificationFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    getNotificationsMock.mockResolvedValue({
      data: [makeNotification("n-1")],
      meta: { pagination: { nextCursor: null } },
    });
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 1, needsAction: 0, mentions: 0 },
    });
  });

  it("fetches notifications on mount and refetches when organizationId changes", async () => {
    const { result, rerender } = renderHook(
      ({ organizationId }: { organizationId: string | null }) =>
        useNotificationFeed(organizationId),
      { initialProps: { organizationId: null as string | null } },
    );

    await waitFor(() => {
      expect(result.current.value.isLoading).toBe(false);
    });

    expect(result.current.value.notifications.map((row) => row.id)).toEqual([
      "n-1",
    ]);
    expect(result.current.value.unreadCount).toBe(1);
    expect(getNotificationsMock).toHaveBeenCalledTimes(1);

    getNotificationsMock.mockResolvedValueOnce({
      data: [makeNotification("n-org")],
      meta: { pagination: { nextCursor: null } },
    });
    getNotificationsCountsMock.mockResolvedValueOnce({
      data: { unread: 2, needsAction: 1, mentions: 0 },
    });

    rerender({ organizationId: "org-1" });

    await waitFor(() => {
      expect(result.current.value.notifications.map((row) => row.id)).toEqual([
        "n-org",
      ]);
    });

    expect(result.current.value.unreadCount).toBe(2);
    expect(result.current.value.needsActionCount).toBe(1);
    expect(getNotificationsMock).toHaveBeenCalledTimes(2);
  });

  it("marks hasFetchError when the initial fetch rejects", async () => {
    expectConsole("error", "Failed to fetch notifications");
    getNotificationsMock.mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(() => useNotificationFeed(null));

    await waitFor(() => {
      expect(result.current.value.isLoading).toBe(false);
    });

    expect(result.current.value.hasFetchError).toBe(true);
  });

  it("applies optimistic markRead and commits the server row", async () => {
    const readRow = makeNotification("n-1", {
      isRead: true,
      readAt: new Date("2026-06-18T09:05:00.000Z"),
    });
    patchNotificationReadMock.mockResolvedValue({ data: readRow });

    const { result } = renderHook(() => useNotificationFeed(null));

    await waitFor(() => {
      expect(result.current.value.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.markRead("n-1");
    });

    expect(patchNotificationReadMock).toHaveBeenCalledWith({ id: "n-1" });
    expect(result.current.value.unreadCount).toBe(0);
    expect(result.current.value.notifications[0]?.isRead).toBe(true);
  });
});
