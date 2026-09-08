import { act, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NotificationProvider,
  useNotifications,
} from "@/contexts/notification-provider";

const getNotificationsMock = vi.fn();
const patchNotificationReadMock = vi.fn();
const patchNotificationsReadAllMock = vi.fn();
const deleteNotificationMock = vi.fn();
const deleteNotificationsMock = vi.fn();
const getNotificationsUnreadCountMock = vi.fn();
const useNotificationRealtimeMock = vi.fn();

const lazyAblyProviderMock = vi.fn(
  ({ children }: { children: ReactNode }): ReactNode => <>{children}</>,
);

vi.mock("@/lib/clients/core.notifications.browser.client", () => ({
  notificationsBrowserClient: {
    getNotifications: (...args: unknown[]) => getNotificationsMock(...args),
    getNotificationsUnreadCount: (...args: unknown[]) =>
      getNotificationsUnreadCountMock(...args),
    patchNotificationRead: (...args: unknown[]) =>
      patchNotificationReadMock(...args),
    patchNotificationsReadAll: (...args: unknown[]) =>
      patchNotificationsReadAllMock(...args),
    deleteNotification: (...args: unknown[]) => deleteNotificationMock(...args),
    deleteNotifications: (...args: unknown[]) =>
      deleteNotificationsMock(...args),
  },
}));

vi.mock("@/lib/ably/use-notification-realtime", () => ({
  useNotificationRealtime: (...args: unknown[]) =>
    useNotificationRealtimeMock(...args),
}));

vi.mock("ably/react", () => ({
  ChannelProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="notifications-channel-provider">{children}</div>
  ),
}));

vi.mock("@/contexts/lazy-ably-provider", () => ({
  default: (props: { children: ReactNode }) => lazyAblyProviderMock(props),
}));

vi.mock("@/app/components/notification-toast-listener", () => ({
  NotificationToastListener: ({
    userId,
  }: {
    userId: string;
    markRead: (id: string) => Promise<void>;
  }) => <div data-testid="notification-toast-listener">{userId}</div>,
}));

let currentNotifications: ReturnType<typeof useNotifications>;

function NotificationConsumer() {
  currentNotifications = useNotifications();
  const {
    isLoading,
    hasFetchError,
    unreadCount,
    notifications,
    deleteNotification,
    clearNotifications,
  } = useNotifications();

  return (
    <div data-testid="notification-consumer">
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="fetch-error">{String(hasFetchError)}</span>
      <span data-testid="unread-count">{unreadCount}</span>
      <span data-testid="notification-ids">
        {notifications.map((notification) => notification.id).join(",")}
      </span>
      <button
        type="button"
        data-testid="delete-first"
        onClick={() => {
          void deleteNotification(notifications[0]?.id ?? "").catch(() => {});
        }}
      >
        delete
      </button>
      <button
        type="button"
        data-testid="delete-elsewhere"
        onClick={() => {
          // A row the page holds and this list does not, as deep paging gives.
          void deleteNotification("notification-elsewhere").catch(() => {});
        }}
      >
        delete elsewhere
      </button>
      <button
        type="button"
        data-testid="clear-all"
        onClick={() => {
          void clearNotifications().catch(() => {});
        }}
      >
        clear
      </button>
    </div>
  );
}

describe("NotificationProvider island", () => {
  beforeEach(() => {
    getNotificationsMock.mockReset();
    patchNotificationReadMock.mockReset();
    patchNotificationsReadAllMock.mockReset();
    getNotificationsUnreadCountMock.mockReset();
    useNotificationRealtimeMock.mockReset();
    lazyAblyProviderMock.mockReset();
    lazyAblyProviderMock.mockImplementation(
      ({ children }: { children: ReactNode }): ReactNode => <>{children}</>,
    );

    deleteNotificationMock.mockReset();
    deleteNotificationsMock.mockReset();
    getNotificationsMock.mockResolvedValue({ data: [] });
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 0 } });
  });

  it("renders children and REST context without waiting on Ably", async () => {
    lazyAblyProviderMock.mockImplementation((): ReactNode => null);

    render(
      <NotificationProvider userId="user-1">
        <NotificationConsumer />
      </NotificationProvider>,
    );

    expect(screen.getByTestId("notification-consumer")).toBeInTheDocument();
    expect(
      screen.queryByTestId("notifications-channel-provider"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("notification-toast-listener"),
    ).not.toBeInTheDocument();
    expect(useNotificationRealtimeMock).not.toHaveBeenCalled();

    await act(async () => {
      await Promise.resolve();
    });

    expect(getNotificationsMock).toHaveBeenCalled();
    expect(getNotificationsUnreadCountMock).toHaveBeenCalled();
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("fetch-error")).toHaveTextContent("false");
    expect(screen.getByTestId("unread-count")).toHaveTextContent("0");
  });

  it("mounts realtime bridge and toast listener under the LazyAbly island", async () => {
    render(
      <NotificationProvider userId="user-1">
        <NotificationConsumer />
      </NotificationProvider>,
    );

    expect(
      screen.getByTestId("notifications-channel-provider"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("notification-toast-listener")).toHaveTextContent(
      "user-1",
    );
    expect(useNotificationRealtimeMock).toHaveBeenCalled();

    await act(async () => {
      await Promise.resolve();
    });
  });

  /** Emits one realtime event through the bridge's own callback. */
  async function emit(notification: Record<string, unknown>) {
    render(
      <NotificationProvider userId="user-1">
        <NotificationConsumer />
      </NotificationProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const onNotification = useNotificationRealtimeMock.mock.calls
      .map(
        (call) =>
          (call[0] as { onNotification?: (event: unknown) => void })
            .onNotification,
      )
      .find(Boolean);

    await act(async () => {
      onNotification?.(notification);
    });
  }

  const REALTIME_EVENT = {
    id: "notification-1",
    userId: "user-1",
    kind: "JOB",
    referenceId: "job-1",
    eventId: "event-1",
    messageKey: "Notifications.Job.completed",
    messageParams: {},
    metadata: null,
    isRead: false,
    readAt: null,
    createdAt: "2026-06-18T09:00:00.000Z",
    inApp: true,
    osBanner: true,
    created: true,
  };

  it("counts a delivered notification the moment it arrives", async () => {
    await emit(REALTIME_EVENT);

    expect(screen.getByTestId("unread-count")).toHaveTextContent("1");
  });

  /**
   * A room's later messages arrive as changes to the row the first one wrote,
   * and the badge already counted that row.
   */
  it("leaves the bell alone for a row the event only changed", async () => {
    await emit({ ...REALTIME_EVENT, created: false });

    expect(screen.getByTestId("unread-count")).toHaveTextContent("0");
  });

  /**
   * The event still arrives, because the OS banner rides it. The bell is what
   * the reader silenced, so it must not move.
   */
  it("leaves the bell alone for a notification silenced in the app", async () => {
    await emit({ ...REALTIME_EVENT, inApp: false });

    expect(screen.getByTestId("unread-count")).toHaveTextContent("0");
  });

  it("surfaces fetch errors on the immediate path without Ably", async () => {
    lazyAblyProviderMock.mockImplementation((): ReactNode => null);
    getNotificationsMock.mockRejectedValue(new Error("network down"));

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(
      <NotificationProvider userId="user-1">
        <NotificationConsumer />
      </NotificationProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("fetch-error")).toHaveTextContent("true");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(useNotificationRealtimeMock).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("refetches after the Ably island mounts so REST-before-subscribe gaps close", async () => {
    let islandOpen = false;
    let bumpGate: (() => void) | null = null;

    function GatedLazyAbly({ children }: { children: ReactNode }) {
      const [, setTick] = useState(0);
      bumpGate = () => {
        setTick((tick) => tick + 1);
      };
      if (!islandOpen) {
        return null;
      }
      return <>{children}</>;
    }

    lazyAblyProviderMock.mockImplementation(
      ({ children }: { children: ReactNode }) => (
        <GatedLazyAbly>{children}</GatedLazyAbly>
      ),
    );

    getNotificationsMock
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [
          {
            id: "notification-gap",
            userId: "user-1",
            kind: "JOB",
            referenceId: "job-1",
            eventId: "event-1",
            messageKey: "Notifications.Job.completed",
            messageParams: {},
            metadata: {},
            isRead: false,
            readAt: null,
            createdAt: new Date("2026-06-18T09:00:00.000Z"),
          },
        ],
      });
    getNotificationsUnreadCountMock
      .mockResolvedValueOnce({ data: { count: 0 } })
      .mockResolvedValueOnce({ data: { count: 1 } });

    render(
      <NotificationProvider userId="user-1">
        <NotificationConsumer />
      </NotificationProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getNotificationsMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("unread-count")).toHaveTextContent("0");
    expect(useNotificationRealtimeMock).not.toHaveBeenCalled();

    islandOpen = true;
    await act(async () => {
      bumpGate?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useNotificationRealtimeMock).toHaveBeenCalled();
    expect(getNotificationsMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("unread-count")).toHaveTextContent("1");
  });
});

describe("NotificationProvider deleting", () => {
  const UNREAD_ROW = {
    id: "notification-unread",
    userId: "user-1",
    kind: "JOB" as const,
    referenceId: "job-1",
    eventId: "event-1",
    messageKey: "Notifications.Job.completed",
    messageParams: {},
    metadata: null,
    isRead: false,
    readAt: null,
    createdAt: new Date("2026-06-18T09:00:00.000Z"),
  };

  const READ_ROW = {
    ...UNREAD_ROW,
    id: "notification-read",
    isRead: true,
    readAt: new Date("2026-06-18T08:30:00.000Z"),
    createdAt: new Date("2026-06-18T08:00:00.000Z"),
  };

  beforeEach(() => {
    getNotificationsMock.mockReset();
    patchNotificationReadMock.mockReset();
    patchNotificationsReadAllMock.mockReset();
    getNotificationsUnreadCountMock.mockReset();
    deleteNotificationMock.mockReset();
    deleteNotificationsMock.mockReset();
    useNotificationRealtimeMock.mockReset();
    lazyAblyProviderMock.mockReset();
    lazyAblyProviderMock.mockImplementation(
      ({ children }: { children: ReactNode }): ReactNode => <>{children}</>,
    );

    getNotificationsMock.mockResolvedValue({ data: [UNREAD_ROW, READ_ROW] });
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 1 } });
    deleteNotificationMock.mockResolvedValue({ data: UNREAD_ROW });
    deleteNotificationsMock.mockResolvedValue({ data: { count: 2 } });
  });

  async function renderLoaded() {
    render(
      <NotificationProvider userId="user-1">
        <NotificationConsumer />
      </NotificationProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
  }

  async function press(testId: string) {
    await act(async () => {
      screen.getByTestId(testId).click();
      await Promise.resolve();
    });
  }

  it("takes a deleted row out of the list and off the bell", async () => {
    await renderLoaded();
    await press("delete-first");

    expect(deleteNotificationMock).toHaveBeenCalledWith({
      id: "notification-unread",
    });
    expect(screen.getByTestId("notification-ids")).toHaveTextContent(
      "notification-read",
    );
    expect(screen.getByTestId("unread-count")).toHaveTextContent("0");
  });

  it("leaves the bell alone when the deleted row was already read", async () => {
    getNotificationsMock.mockResolvedValue({
      data: [
        { ...READ_ROW, createdAt: new Date("2026-06-18T10:00:00.000Z") },
        UNREAD_ROW,
      ],
    });

    await renderLoaded();
    await press("delete-first");

    expect(deleteNotificationMock).toHaveBeenCalledWith({
      id: "notification-read",
    });
    expect(screen.getByTestId("unread-count")).toHaveTextContent("1");
  });

  it("takes the badge off an unread row this list never held", async () => {
    deleteNotificationMock.mockResolvedValue({
      data: { ...UNREAD_ROW, id: "notification-elsewhere" },
    });

    await renderLoaded();
    await press("delete-elsewhere");

    expect(deleteNotificationMock).toHaveBeenCalledWith({
      id: "notification-elsewhere",
    });
    expect(screen.getByTestId("notification-ids")).toHaveTextContent(
      "notification-unread,notification-read",
    );
    expect(screen.getByTestId("unread-count")).toHaveTextContent("0");
  });

  it("leaves the badge alone when a row this list never held was read", async () => {
    deleteNotificationMock.mockResolvedValue({
      data: { ...READ_ROW, id: "notification-elsewhere" },
    });

    await renderLoaded();
    await press("delete-elsewhere");

    expect(screen.getByTestId("unread-count")).toHaveTextContent("1");
  });

  it("empties the list and the bell when the reader clears the center", async () => {
    await renderLoaded();
    getNotificationsMock.mockResolvedValue({ data: [] });
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 0 } });
    await press("clear-all");

    expect(deleteNotificationsMock).toHaveBeenCalled();
    expect(screen.getByTestId("notification-ids")).toHaveTextContent("");
    expect(screen.getByTestId("unread-count")).toHaveTextContent("0");
  });

  it("reads the list again when a delete fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    deleteNotificationMock.mockRejectedValue(new Error("network down"));

    await renderLoaded();
    // The provider reads on mount and again when the realtime bridge attaches,
    // so the count that matters is the one the failure adds.
    const readsBeforeDelete = getNotificationsMock.mock.calls.length;

    await press("delete-first");

    expect(getNotificationsMock).toHaveBeenCalledTimes(readsBeforeDelete + 1);
    consoleError.mockRestore();
  });

  it("reads the list again when clearing fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    deleteNotificationsMock.mockRejectedValue(new Error("network down"));

    await renderLoaded();
    const readsBeforeClear = getNotificationsMock.mock.calls.length;

    await press("clear-all");

    expect(getNotificationsMock).toHaveBeenCalledTimes(readsBeforeClear + 1);
    consoleError.mockRestore();
  });
  it("discards a pending read after a successful deletion", async () => {
    await renderLoaded();
    let finishRead!: (value: {
      data: (typeof UNREAD_ROW | typeof READ_ROW)[];
    }) => void;
    getNotificationsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishRead = resolve;
      }),
    );
    let pendingRead!: Promise<void>;
    await act(async () => {
      pendingRead = currentNotifications.refetch();
    });
    await press("delete-first");
    await act(async () => {
      finishRead({ data: [UNREAD_ROW, READ_ROW] });
      await pendingRead;
    });
    expect(currentNotifications.notifications.map((row) => row.id)).toEqual([
      READ_ROW.id,
    ]);
    expect(currentNotifications.unreadCount).toBe(0);
    expect(currentNotifications.isLoading).toBe(false);
  });

  it("discards rows deleted elsewhere when a fresh read omits them", async () => {
    await renderLoaded();
    getNotificationsMock.mockResolvedValue({ data: [] });
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 0 } });
    await act(async () => {
      await currentNotifications.refetch();
    });
    expect(currentNotifications.notifications).toEqual([]);
    expect(currentNotifications.unreadCount).toBe(0);
  });

  it.each(["deleteNotification", "clearNotifications"] as const)(
    "restores state offline after %s fails",
    async (operation) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      await renderLoaded();
      deleteNotificationMock.mockRejectedValue(new Error("offline"));
      deleteNotificationsMock.mockRejectedValue(new Error("offline"));
      getNotificationsMock.mockRejectedValue(new Error("offline"));
      await act(async () => {
        await currentNotifications[operation](UNREAD_ROW.id).catch(() => {});
      });
      expect(currentNotifications.notifications.map((row) => row.id)).toEqual([
        UNREAD_ROW.id,
        READ_ROW.id,
      ]);
      expect(currentNotifications.unreadCount).toBe(1);
      consoleError.mockRestore();
    },
  );

  it("keeps another successful deletion when a clear fails offline", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await renderLoaded();
    let rejectClear!: (error: Error) => void;
    deleteNotificationsMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectClear = reject;
      }),
    );
    let pendingClear!: Promise<void>;
    await act(async () => {
      pendingClear = currentNotifications.clearNotifications().catch(() => {});
    });
    deleteNotificationMock.mockResolvedValue({ data: READ_ROW });
    await act(async () => {
      await currentNotifications.deleteNotification(READ_ROW.id);
    });
    getNotificationsMock.mockRejectedValue(new Error("offline"));
    await act(async () => {
      rejectClear(new Error("offline"));
      await pendingClear;
    });
    expect(currentNotifications.notifications.map((row) => row.id)).toEqual([
      UNREAD_ROW.id,
    ]);
    expect(currentNotifications.unreadCount).toBe(1);
    consoleError.mockRestore();
  });
  async function deliverRealtime(id: string) {
    const onNotification =
      useNotificationRealtimeMock.mock.lastCall?.[0].onNotification;
    expect(onNotification).toBeTypeOf("function");
    await act(async () => {
      onNotification({
        ...UNREAD_ROW,
        id,
        createdAt: "2026-06-18T10:00:00.000Z",
        inApp: true,
        osBanner: true,
        created: true,
      });
    });
  }

  it("preserves realtime delivered during a read, but not during an earlier read", async () => {
    await renderLoaded();
    let finishRead!: (value: {
      data: (typeof UNREAD_ROW | typeof READ_ROW)[];
    }) => void;
    getNotificationsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishRead = resolve;
      }),
    );
    let pendingRead!: Promise<void>;
    await act(async () => {
      pendingRead = currentNotifications.refetch();
    });
    await deliverRealtime("notification-during-fetch");
    await act(async () => {
      finishRead({ data: [UNREAD_ROW, READ_ROW] });
      await pendingRead;
    });
    expect(currentNotifications.notifications[0]?.id).toBe(
      "notification-during-fetch",
    );
    expect(currentNotifications.unreadCount).toBe(2);
    getNotificationsMock.mockResolvedValue({ data: [] });
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 0 } });
    await act(async () => {
      await currentNotifications.refetch();
    });
    expect(currentNotifications.notifications).toEqual([]);
    expect(currentNotifications.unreadCount).toBe(0);
  });

  it("preserves realtime when a clear fails offline", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await renderLoaded();
    let rejectClear!: (error: Error) => void;
    deleteNotificationsMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectClear = reject;
      }),
    );
    let pendingClear!: Promise<void>;
    await act(async () => {
      pendingClear = currentNotifications.clearNotifications().catch(() => {});
    });
    await deliverRealtime("notification-during-clear");
    getNotificationsMock.mockRejectedValue(new Error("offline"));
    await act(async () => {
      rejectClear(new Error("offline"));
      await pendingClear;
    });
    expect(currentNotifications.notifications.map((row) => row.id)).toEqual([
      "notification-during-clear",
      UNREAD_ROW.id,
      READ_ROW.id,
    ]);
    expect(currentNotifications.unreadCount).toBe(2);
    consoleError.mockRestore();
  });

  it("ignores duplicate deletion requests and emits one matching completion", async () => {
    await renderLoaded();
    const listener = vi.fn();
    const unsubscribe = currentNotifications.subscribeToDeletion(listener);
    let finishDelete!: (value: { data: typeof UNREAD_ROW }) => void;
    deleteNotificationMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishDelete = resolve;
      }),
    );
    let pendingDelete!: Promise<void>;
    await act(async () => {
      pendingDelete = currentNotifications.deleteNotification(UNREAD_ROW.id);
      await currentNotifications.deleteNotification(UNREAD_ROW.id);
    });
    expect(deleteNotificationMock).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    const start = listener.mock.calls[0]?.[0];
    expect(start).toMatchObject({
      kind: "delete",
      id: UNREAD_ROW.id,
      phase: "start",
    });
    await act(async () => {
      finishDelete({ data: UNREAD_ROW });
      await pendingDelete;
    });
    expect(listener).toHaveBeenLastCalledWith({ ...start, phase: "success" });
    unsubscribe();
    await act(async () => {
      await currentNotifications.deleteNotification(READ_ROW.id);
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("emits failure before starting its recovery read", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await renderLoaded();
    const phases: string[] = [];
    const unsubscribe = currentNotifications.subscribeToDeletion((event) => {
      phases.push(event.phase);
    });
    deleteNotificationMock.mockRejectedValue(new Error("offline"));
    getNotificationsMock.mockImplementation(async () => {
      expect(phases).toEqual(["start", "failure"]);
      throw new Error("offline");
    });
    await act(async () => {
      await currentNotifications
        .deleteNotification(UNREAD_ROW.id)
        .catch(() => {});
    });
    expect(phases).toEqual(["start", "failure"]);
    unsubscribe();
    consoleError.mockRestore();
  });
  it("ignores a delayed realtime event for a deleted notification", async () => {
    await renderLoaded();
    await act(async () => {
      await currentNotifications.deleteNotification(UNREAD_ROW.id);
    });
    await deliverRealtime(UNREAD_ROW.id);
    expect(currentNotifications.notifications.map((row) => row.id)).toEqual([
      READ_ROW.id,
    ]);
    expect(currentNotifications.unreadCount).toBe(0);
  });

  it("retains notifications created during a successful clear if refetch fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await renderLoaded();
    let finishClear!: (value: { data: { count: number } }) => void;
    deleteNotificationsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishClear = resolve;
      }),
    );
    let pendingClear!: Promise<void>;
    await act(async () => {
      pendingClear = currentNotifications.clearNotifications();
    });
    await deliverRealtime("notification-after-clear");
    await act(async () => {
      await currentNotifications.deleteNotification(UNREAD_ROW.id);
    });
    expect(currentNotifications.unreadCount).toBe(1);
    getNotificationsMock.mockRejectedValue(new Error("offline"));
    await act(async () => {
      finishClear({ data: { count: 1 } });
      await pendingClear;
    });
    expect(currentNotifications.notifications.map((row) => row.id)).toEqual([
      "notification-after-clear",
    ]);
    expect(currentNotifications.unreadCount).toBe(1);
    consoleError.mockRestore();
  });

  it("replays pending deletion starts to a new subscriber", async () => {
    await renderLoaded();
    let finishDelete!: (value: { data: typeof UNREAD_ROW }) => void;
    deleteNotificationMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishDelete = resolve;
      }),
    );
    let pendingDelete!: Promise<void>;
    await act(async () => {
      pendingDelete = currentNotifications.deleteNotification(UNREAD_ROW.id);
    });
    const listener = vi.fn();
    const unsubscribe = currentNotifications.subscribeToDeletion(listener);
    expect(listener).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        kind: "delete",
        id: UNREAD_ROW.id,
        phase: "start",
      }),
    );
    unsubscribe();
    await act(async () => {
      finishDelete({ data: UNREAD_ROW });
      await pendingDelete;
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it("counts deletion of a new row outside the clear overlay window", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await renderLoaded();
    let finishClear!: (value: { data: { count: number } }) => void;
    deleteNotificationsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishClear = resolve;
      }),
    );
    let pendingClear!: Promise<void>;
    await act(async () => {
      pendingClear = currentNotifications.clearNotifications();
    });
    for (let index = 0; index < 11; index++)
      await deliverRealtime(`new-${index}`);
    deleteNotificationMock.mockResolvedValue({
      data: { ...UNREAD_ROW, id: "new-0" },
    });
    await act(async () => {
      await currentNotifications.deleteNotification("new-0");
    });
    getNotificationsMock.mockRejectedValue(new Error("offline"));
    await act(async () => {
      finishClear({ data: { count: 2 } });
      await pendingClear;
    });
    expect(currentNotifications.unreadCount).toBe(10);
    consoleError.mockRestore();
  });
  it("ignores a pre-clear read response for an older row outside the provider window", async () => {
    await renderLoaded();
    let finishRead!: (value: { data: typeof READ_ROW }) => void;
    patchNotificationReadMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishRead = resolve;
      }),
    );
    let pendingRead!: Promise<void>;
    await act(async () => {
      pendingRead = currentNotifications.markRead("older-unheld");
    });
    getNotificationsMock.mockResolvedValue({ data: [] });
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 0 } });
    await act(async () => {
      await currentNotifications.clearNotifications();
    });
    await deliverRealtime("new-after-clear");
    await act(async () => {
      finishRead({ data: { ...READ_ROW, id: "older-unheld" } });
      await pendingRead;
    });
    expect(currentNotifications.notifications.map((row) => row.id)).toEqual([
      "new-after-clear",
    ]);
    expect(currentNotifications.unreadCount).toBe(1);
  });

  it("optimistically counts an older unread deletion once and restores it on failure", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 2 } });
    await renderLoaded();
    let rejectDelete!: (error: Error) => void;
    deleteNotificationMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectDelete = reject;
      }),
    );
    let pendingDelete!: Promise<void>;
    await act(async () => {
      pendingDelete = currentNotifications
        .deleteNotification("older-unheld", { isRead: false })
        .catch(() => {});
      await currentNotifications.deleteNotification("older-unheld", {
        isRead: false,
      });
    });
    expect(deleteNotificationMock).toHaveBeenCalledTimes(1);
    expect(currentNotifications.unreadCount).toBe(1);
    getNotificationsMock.mockRejectedValue(new Error("offline"));
    await act(async () => {
      rejectDelete(new Error("offline"));
      await pendingDelete;
    });
    expect(currentNotifications.unreadCount).toBe(2);
    consoleError.mockRestore();
  });

  it("keeps the optimistic count when an older unread deletion succeeds", async () => {
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 2 } });
    await renderLoaded();
    let finishDelete!: (value: { data: typeof UNREAD_ROW }) => void;
    deleteNotificationMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishDelete = resolve;
      }),
    );
    let pendingDelete!: Promise<void>;
    await act(async () => {
      pendingDelete = currentNotifications.deleteNotification("older-unheld", {
        isRead: false,
      });
    });
    expect(currentNotifications.unreadCount).toBe(1);
    await act(async () => {
      finishDelete({ data: { ...UNREAD_ROW, id: "older-unheld" } });
      await pendingDelete;
    });
    expect(currentNotifications.unreadCount).toBe(1);
  });

  it("does not charge a pending older deletion against rows arriving after mark all read", async () => {
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 2 } });
    await renderLoaded();
    let finishDelete!: (value: { data: typeof READ_ROW }) => void;
    deleteNotificationMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishDelete = resolve;
      }),
    );
    let pendingDelete!: Promise<void>;
    await act(async () => {
      pendingDelete = currentNotifications.deleteNotification("older-unheld", {
        isRead: false,
      });
    });
    await act(async () => {
      await currentNotifications.markAllRead();
    });
    await deliverRealtime("new-after-read-all");
    expect(currentNotifications.unreadCount).toBe(1);
    await act(async () => {
      finishDelete({ data: { ...READ_ROW, id: "older-unheld" } });
      await pendingDelete;
    });
    expect(currentNotifications.unreadCount).toBe(1);
  });

  it("does not charge a pending older deletion against rows arriving after clear", async () => {
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 2 } });
    await renderLoaded();
    let finishDelete!: (value: { data: typeof UNREAD_ROW }) => void;
    deleteNotificationMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishDelete = resolve;
      }),
    );
    let pendingDelete!: Promise<void>;
    await act(async () => {
      pendingDelete = currentNotifications.deleteNotification("older-unheld", {
        isRead: false,
      });
    });
    await act(async () => {
      await currentNotifications.clearNotifications();
    });
    await deliverRealtime("new-after-clear");
    expect(currentNotifications.unreadCount).toBe(1);
    getNotificationsMock.mockResolvedValue({
      data: [{ ...UNREAD_ROW, id: "new-after-clear" }],
    });
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 1 } });
    await act(async () => {
      finishDelete({ data: { ...UNREAD_ROW, id: "older-unheld" } });
      await pendingDelete;
    });
    expect(currentNotifications.unreadCount).toBe(1);
  });

  it("applies an older read response when the overlapping clear fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 2 } });
    await renderLoaded();
    let finishRead!: (value: { data: typeof READ_ROW }) => void;
    patchNotificationReadMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishRead = resolve;
      }),
    );
    let pendingRead!: Promise<void>;
    await act(async () => {
      pendingRead = currentNotifications.markRead("older-unheld");
    });
    deleteNotificationsMock.mockRejectedValue(new Error("offline"));
    getNotificationsMock.mockRejectedValue(new Error("offline"));
    await act(async () => {
      await currentNotifications.clearNotifications().catch(() => {});
    });
    await act(async () => {
      finishRead({ data: { ...READ_ROW, id: "older-unheld" } });
      await pendingRead;
    });
    expect(currentNotifications.unreadCount).toBe(1);
    consoleError.mockRestore();
  });

  it("does not count a read response and a pending older deletion twice", async () => {
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 2 } });
    await renderLoaded();
    let finishDelete!: (value: { data: typeof READ_ROW }) => void;
    deleteNotificationMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishDelete = resolve;
      }),
    );
    let pendingDelete!: Promise<void>;
    await act(async () => {
      pendingDelete = currentNotifications.deleteNotification("older-unheld", {
        isRead: false,
      });
    });
    patchNotificationReadMock.mockResolvedValue({
      data: { ...READ_ROW, id: "older-unheld" },
    });
    await act(async () => {
      await currentNotifications.markRead("older-unheld");
    });
    expect(currentNotifications.unreadCount).toBe(1);
    await act(async () => {
      finishDelete({ data: { ...READ_ROW, id: "older-unheld" } });
      await pendingDelete;
    });
    expect(currentNotifications.unreadCount).toBe(1);
  });
});
