import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";

import {
  NotificationProvider,
  useNotifications,
} from "@/contexts/notification-provider";
import type { NotificationEventData } from "@/lib/ably";
import type { NotificationItem } from "@/lib/clients/generated/core";

import { useNotificationsPage } from "./use-notifications-page";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  count: vi.fn(),
  delete: vi.fn(),
  clear: vi.fn(),
  realtime: undefined as undefined | ((event: NotificationEventData) => void),
}));
vi.mock("@/lib/clients/core.notifications.browser.client", () => ({
  notificationsBrowserClient: {
    getNotifications: mocks.get,
    getNotificationsUnreadCount: mocks.count,
    deleteNotification: mocks.delete,
    deleteNotifications: mocks.clear,
  },
}));
vi.mock("@/contexts/lazy-ably-provider", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("ably/react", () => ({
  ChannelProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/ably/use-notification-realtime", () => ({
  useNotificationRealtime: ({
    onNotification,
  }: {
    onNotification: (event: NotificationEventData) => void;
  }) => {
    mocks.realtime = onNotification;
  },
}));
vi.mock("@/app/components/notification-toast-listener", () => ({
  NotificationToastListener: () => null,
}));

function notification(id: string): NotificationItem {
  return {
    id,
    userId: "user",
    kind: "JOB",
    referenceId: "job",
    eventId: "event",
    messageKey: id,
    messageParams: {},
    metadata: null,
    isRead: false,
    readAt: null,
    createdAt: new Date(),
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <NotificationProvider userId="user">{children}</NotificationProvider>;
}

const rows = [notification("first"), notification("last")];

beforeEach(() => {
  mocks.get.mockReset();
  mocks.delete.mockReset();
  mocks.clear.mockReset();
  mocks.count.mockResolvedValue({ data: { count: 2 } });
  mocks.get.mockImplementation(async ({ limit }: { limit: number }) => ({
    data: limit === 20 ? rows : rows.slice(0, 1),
    meta: { pagination: { nextCursor: null } },
  }));
});

function usePageAndProvider() {
  return { page: useNotificationsPage(), provider: useNotifications() };
}

it("applies a bell deletion to the page and badge through the real provider", async () => {
  const { result } = renderHook(usePageAndProvider, { wrapper });
  await waitFor(() =>
    expect(result.current.page.notifications).toHaveLength(2),
  );
  mocks.delete.mockResolvedValue({ data: rows[0] });
  await act(async () => {
    await result.current.provider.deleteNotification("first");
  });
  expect(result.current.page.notifications.map((item) => item.id)).toEqual([
    "last",
  ]);
  expect(result.current.provider.unreadCount).toBe(1);
});

it("restores the entire page after clear and recovery both fail offline", async () => {
  const { result } = renderHook(usePageAndProvider, { wrapper });
  await waitFor(() =>
    expect(result.current.page.notifications).toHaveLength(2),
  );
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.clear.mockRejectedValue(new Error("offline"));
  mocks.get.mockRejectedValue(new Error("offline"));
  await act(async () => {
    await result.current.provider.clearNotifications().catch(() => {});
  });
  expect(result.current.page.notifications.map((item) => item.id)).toEqual([
    "first",
    "last",
  ]);
  expect(result.current.provider.unreadCount).toBe(2);
  error.mockRestore();
});

it("keeps a deleted page-only row gone when another deletion fails", async () => {
  const { result } = renderHook(usePageAndProvider, { wrapper });
  await waitFor(() =>
    expect(result.current.page.notifications).toHaveLength(2),
  );
  let fail!: (error: Error) => void;
  mocks.delete.mockImplementation(({ id }: { id: string }) =>
    id === "first"
      ? new Promise((_resolve, reject) => {
          fail = reject;
        })
      : Promise.resolve({ data: rows[1] }),
  );
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  let first!: Promise<void>;
  act(() => {
    first = result.current.provider.deleteNotification("first").catch(() => {});
  });
  await act(async () => {
    await result.current.provider.deleteNotification("last");
  });
  mocks.get.mockRejectedValue(new Error("offline"));
  await act(async () => {
    fail(new Error("offline"));
    await first;
  });
  expect(result.current.page.notifications.map((item) => item.id)).toEqual([
    "first",
  ]);
  expect(result.current.provider.unreadCount).toBe(1);
  error.mockRestore();
});

it.each([false, true])(
  "reconciles a notification arriving during clear (survives: %s)",
  async (survives) => {
    const { result } = renderHook(usePageAndProvider, { wrapper });
    await waitFor(() =>
      expect(result.current.page.notifications).toHaveLength(2),
    );
    let complete!: () => void;
    mocks.clear.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    let operation!: Promise<void>;
    act(() => {
      operation = result.current.provider.clearNotifications();
    });
    const newer = notification("during-clear");
    act(() => {
      mocks.realtime?.({
        ...newer,
        messageParams: newer.messageParams ?? {},
        createdAt: newer.createdAt.toISOString(),
        readAt: null,
        inApp: true,
        osBanner: true,
        created: true,
      });
    });
    await waitFor(() =>
      expect(result.current.page.notifications.map((row) => row.id)).toEqual([
        newer.id,
      ]),
    );
    mocks.get.mockResolvedValue({
      data: survives ? [newer] : [],
      meta: { pagination: { nextCursor: null } },
    });
    mocks.count.mockResolvedValue({ data: { count: survives ? 1 : 0 } });
    await act(async () => {
      complete();
      await operation;
    });
    await waitFor(() =>
      expect(
        result.current.provider.notifications.map((row) => row.id),
      ).toEqual(survives ? [newer.id] : []),
    );
    await waitFor(() =>
      expect(result.current.page.notifications.map((row) => row.id)).toEqual(
        survives ? [newer.id] : [],
      ),
    );
  },
);
