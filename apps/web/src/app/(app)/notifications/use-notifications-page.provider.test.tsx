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
  markAll: vi.fn(),
  realtime: undefined as undefined | ((event: NotificationEventData) => void),
}));
vi.mock("@/lib/clients/core.notifications.browser.client", () => ({
  notificationsBrowserClient: {
    getNotifications: mocks.get,
    getNotificationsUnreadCount: mocks.count,
    deleteNotification: mocks.delete,
    deleteNotifications: mocks.clear,
    patchNotificationsReadAll: mocks.markAll,
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
  mocks.markAll.mockReset();
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

it.each([1, 2, 11])(
  "retains %i new notifications in order during post-clear page reconciliation",
  async (count) => {
    const { result } = renderHook(usePageAndProvider, { wrapper });
    await waitFor(() =>
      expect(result.current.page.notifications).toHaveLength(2),
    );
    let completePage!: (value: {
      data: NotificationItem[];
      meta: { pagination: { nextCursor: null } };
    }) => void;
    const pageResponse = new Promise((resolve) => {
      completePage = resolve;
    });
    mocks.clear.mockResolvedValue(undefined);
    mocks.get.mockImplementation(({ limit }: { limit: number }) =>
      limit === 20
        ? pageResponse
        : Promise.resolve({
            data: [],
            meta: { pagination: { nextCursor: null } },
          }),
    );
    mocks.count.mockResolvedValue({ data: { count: 0 } });
    await act(async () => {
      await result.current.provider.clearNotifications();
    });
    const ids: string[] = [];
    for (let index = 0; index < count; index++) {
      const newer = notification(`after-clear-${index}`);
      newer.createdAt = new Date(Date.UTC(2026, 8, 8) + index);
      ids.unshift(newer.id);
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
        expect(result.current.page.notifications.map((row) => row.id)).toEqual(
          ids,
        ),
      );
    }
    await act(async () => {
      completePage({ data: [], meta: { pagination: { nextCursor: null } } });
    });
    expect(result.current.provider.notifications.map((row) => row.id)).toEqual(
      ids.slice(0, 10),
    );
    expect(result.current.page.notifications.map((row) => row.id)).toEqual(ids);
  },
);

it("does not preserve a clear ghost when its event shares the clear completion batch", async () => {
  const { result } = renderHook(usePageAndProvider, { wrapper });
  await waitFor(() =>
    expect(result.current.page.notifications).toHaveLength(2),
  );
  let finishClear!: () => void;
  mocks.clear.mockReturnValue(
    new Promise<void>((resolve) => {
      finishClear = resolve;
    }),
  );
  let operation!: Promise<void>;
  act(() => {
    operation = result.current.provider.clearNotifications();
  });
  let finishPage!: (value: unknown) => void;
  let finishProvider!: (value: unknown) => void;
  const pageResult = new Promise((resolve) => {
    finishPage = resolve;
  });
  const providerResult = new Promise((resolve) => {
    finishProvider = resolve;
  });
  mocks.get.mockImplementation(({ limit }: { limit: number }) =>
    limit === 20 ? pageResult : providerResult,
  );
  mocks.count.mockResolvedValue({ data: { count: 0 } });
  const ghost = notification("same-batch-ghost");
  await act(async () => {
    mocks.realtime?.({
      ...ghost,
      messageParams: {},
      createdAt: ghost.createdAt.toISOString(),
      readAt: null,
      inApp: true,
      osBanner: true,
      created: true,
    });
    finishClear();
    await operation;
  });
  await act(async () => {
    finishProvider({ data: [], meta: { pagination: { nextCursor: null } } });
  });
  expect(result.current.provider.notifications).toHaveLength(0);
  await act(async () => {
    finishPage({ data: [], meta: { pagination: { nextCursor: null } } });
  });
  expect(result.current.page.notifications).toHaveLength(0);
});

it.each([false, true])(
  "retries read rollback after a pending deletion settles (fails: %s)",
  async (deleteFails) => {
    const serverRows = Array.from({ length: 12 }, (_, index) =>
      notification(`row-${index}`),
    );
    function response(data: NotificationItem[]) {
      return { data, meta: { pagination: { nextCursor: null } } };
    }
    mocks.get.mockImplementation(async ({ limit }: { limit: number }) =>
      response(serverRows.slice(0, limit)),
    );
    mocks.count.mockResolvedValue({ data: { count: serverRows.length } });
    const { result } = renderHook(usePageAndProvider, { wrapper });
    await waitFor(() =>
      expect(result.current.page.notifications).toHaveLength(12),
    );
    let failMarkAll!: (error: Error) => void;
    let finishDelete!: () => void;
    mocks.markAll.mockReturnValue(
      new Promise((_resolve, reject) => {
        failMarkAll = reject;
      }),
    );
    mocks.delete.mockReturnValue(
      new Promise((resolve, reject) => {
        finishDelete = () =>
          deleteFails
            ? reject(new Error("delete failed"))
            : resolve({ data: serverRows[0] });
      }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let markAll!: Promise<void>;
    act(() => {
      // Match the page's optimistic update and failed Mark all read recovery.
      result.current.page.setNotifications((notifications) =>
        notifications.map((row) => ({
          ...row,
          isRead: true,
          readAt: new Date(),
        })),
      );
      markAll = result.current.provider.markAllRead().catch(() => {
        void result.current.page.fetchNotifications();
      });
    });
    let deletion!: Promise<void>;
    act(() => {
      deletion = result.current.provider
        .deleteNotification(serverRows[0].id, { isRead: true })
        .catch(() => {});
    });
    const pageReadsBeforeFailure = mocks.get.mock.calls.filter(
      ([request]) => request.limit === 20,
    ).length;
    await act(async () => {
      failMarkAll(new Error("mark all failed"));
      await markAll;
    });
    expect(
      mocks.get.mock.calls.filter(([request]) => request.limit === 20),
    ).toHaveLength(pageReadsBeforeFailure);
    const remaining = deleteFails ? serverRows : serverRows.slice(1);
    mocks.get.mockImplementation(async ({ limit }: { limit: number }) =>
      response(remaining.slice(0, limit)),
    );
    mocks.count.mockResolvedValue({ data: { count: remaining.length } });
    await act(async () => {
      finishDelete();
      await deletion;
    });
    await waitFor(() =>
      expect(result.current.provider.unreadCount).toBe(remaining.length),
    );
    expect(
      result.current.page.notifications.find(
        (row) => row.id === serverRows[11].id,
      )?.isRead,
    ).toBe(false);
    expect(
      mocks.get.mock.calls.filter(([request]) => request.limit === 20),
    ).toHaveLength(pageReadsBeforeFailure + 1);
    error.mockRestore();
  },
);
