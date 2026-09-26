import { act, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NotificationProvider,
  useNotifications,
} from "@/contexts/notification-provider";
import { CoreApiRequestError } from "@/lib/clients/core.request";

const getNotificationsMock = vi.fn();

/** Core always answers a list with pagination meta; most cases here do not
    care what is in it, so they may leave it out. */
async function withPagination(response: unknown) {
  const listed = response as {
    data: unknown;
    meta?: { pagination: { nextCursor: string | null } };
  };
  return {
    ...listed,
    meta: listed.meta ?? { pagination: { nextCursor: null } },
  };
}
const patchNotificationReadMock = vi.fn();
const patchNotificationUnreadMock = vi.fn();
const patchNotificationsReadAllMock = vi.fn();
const getNotificationsCountsMock = vi.fn();
const useNotificationRealtimeMock = vi.fn();
const useNotificationFrontPresenceMock = vi.fn();
const healPushSubscriptionMock = vi.fn();

const lazyAblyProviderMock = vi.fn(
  ({ children }: { children: ReactNode }): ReactNode => (
    <div data-testid="lazy-ably-island">{children}</div>
  ),
);

vi.mock("@/lib/clients/core.notifications.browser.client", () => ({
  notificationsBrowserClient: {
    getNotifications: async (...args: unknown[]) =>
      withPagination(await getNotificationsMock(...args)),
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

vi.mock("@/lib/ably/use-notification-realtime", () => ({
  useNotificationRealtime: (...args: unknown[]) =>
    useNotificationRealtimeMock(...args),
}));

vi.mock("@/lib/ably/use-notification-front-presence", () => ({
  useNotificationFrontPresence: (...args: unknown[]) =>
    useNotificationFrontPresenceMock(...args),
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

vi.mock("@/lib/ably/push-self-heal.client", () => ({
  healPushSubscription: (...args: unknown[]) =>
    healPushSubscriptionMock(...args),
}));

vi.mock("@/app/components/notification-url-target-opener", () => ({
  NotificationUrlTargetOpener: (_props: {
    markRead: (id: string) => Promise<void>;
  }) => <div data-testid="notification-url-target-opener" />,
}));

let currentNotifications: ReturnType<typeof useNotifications>;

function NotificationConsumer() {
  currentNotifications = useNotifications();
  const { isLoading, hasFetchError, unreadCount, notifications } =
    useNotifications();

  return (
    <div data-testid="notification-consumer">
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="fetch-error">{String(hasFetchError)}</span>
      <span data-testid="unread-count">{unreadCount}</span>
      <span data-testid="notification-ids">
        {notifications.map((notification) => notification.id).join(",")}
      </span>
    </div>
  );
}

describe("NotificationProvider island", () => {
  beforeEach(() => {
    getNotificationsMock.mockReset();
    patchNotificationReadMock.mockReset();
    patchNotificationUnreadMock.mockReset();
    patchNotificationsReadAllMock.mockReset();
    getNotificationsCountsMock.mockReset();
    useNotificationRealtimeMock.mockReset();
    useNotificationFrontPresenceMock.mockReset();
    healPushSubscriptionMock.mockReset();
    healPushSubscriptionMock.mockResolvedValue(false);
    lazyAblyProviderMock.mockReset();
    lazyAblyProviderMock.mockImplementation(
      ({ children }: { children: ReactNode }): ReactNode => (
        <div data-testid="lazy-ably-island">{children}</div>
      ),
    );

    getNotificationsMock.mockResolvedValue({ data: [] });
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 0, needsAction: 0, mentions: 0 },
    });
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
    // Presence rides the same island. Core reads a member on this channel as
    // the reader looking at the app, so a page that never started an Ably
    // client must enter nothing: a member it could not leave again would hold
    // that reader's emails back for the rest of the session.
    expect(useNotificationFrontPresenceMock).not.toHaveBeenCalled();

    await act(async () => {
      await Promise.resolve();
    });

    expect(getNotificationsMock).toHaveBeenCalled();
    expect(getNotificationsCountsMock).toHaveBeenCalled();
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("fetch-error")).toHaveTextContent("false");
    expect(screen.getByTestId("unread-count")).toHaveTextContent("0");
  });

  /**
   * A browser that was set up for push and lost its subscription is repaired
   * where a signed-in reader arrives, however they got in. Nothing else in
   * the app calls the repair, so this is the only line that wires it.
   */
  it("repairs a push subscription that died on its own", async () => {
    lazyAblyProviderMock.mockImplementation((): ReactNode => null);

    render(
      <NotificationProvider userId="user-1">
        <NotificationConsumer />
      </NotificationProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(healPushSubscriptionMock).toHaveBeenCalledWith("user-1");
  });

  /**
   * Signing in again is a `router.replace` rather than a page load, and this
   * provider carries no key, so the second reader arrives as a new `userId`
   * on the mount the first reader left behind. Repaired on mount alone, they
   * would never be repaired at all.
   */
  it("repairs for a second reader who arrives on the same mount", async () => {
    lazyAblyProviderMock.mockImplementation((): ReactNode => null);

    const { rerender } = render(
      <NotificationProvider userId="user-1">
        <NotificationConsumer />
      </NotificationProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    rerender(
      <NotificationProvider userId="user-2">
        <NotificationConsumer />
      </NotificationProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(healPushSubscriptionMock).toHaveBeenCalledTimes(2);
    expect(healPushSubscriptionMock).toHaveBeenLastCalledWith("user-2");
  });

  it("repairs the new reader when remounted by identity", async () => {
    lazyAblyProviderMock.mockImplementation((): ReactNode => null);

    function Frame({ userId }: { userId: string }) {
      return (
        <NotificationProvider key={userId} userId={userId}>
          <NotificationConsumer />
        </NotificationProvider>
      );
    }

    const { rerender } = render(<Frame userId="user-1" />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(healPushSubscriptionMock).toHaveBeenCalledWith("user-1");

    healPushSubscriptionMock.mockClear();
    rerender(<Frame userId="user-2" />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(healPushSubscriptionMock).toHaveBeenCalledTimes(1);
    expect(healPushSubscriptionMock).toHaveBeenCalledWith("user-2");
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
    // With the reader's own id: presence is entered on that reader's
    // notifications channel, which is the channel Core asks about before it
    // holds one of their emails back.
    expect(useNotificationFrontPresenceMock).toHaveBeenCalledWith("user-1");

    // Outside the island, unlike the two above. A window the push worker
    // opened carries its target on the URL, and spending that must not wait
    // on the Ably chunk to load or on a client that may never start.
    const opener = screen.getByTestId("notification-url-target-opener");
    expect(opener).toBeInTheDocument();
    expect(screen.getByTestId("lazy-ably-island").contains(opener)).toBe(false);

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
    getNotificationsCountsMock
      .mockResolvedValueOnce({
        data: { unread: 0, needsAction: 0, mentions: 0 },
      })
      .mockResolvedValueOnce({
        data: { unread: 1, needsAction: 0, mentions: 0 },
      });

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

describe("NotificationProvider read state", () => {
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
    getNotificationsCountsMock.mockReset();
    useNotificationRealtimeMock.mockReset();
    useNotificationFrontPresenceMock.mockReset();
    lazyAblyProviderMock.mockReset();
    lazyAblyProviderMock.mockImplementation(
      ({ children }: { children: ReactNode }): ReactNode => <>{children}</>,
    );

    getNotificationsMock.mockResolvedValue({ data: [UNREAD_ROW, READ_ROW] });
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 1, needsAction: 0, mentions: 0 },
    });
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

  it("a delayed unread response must not undo later mark all read", async () => {
    let resolveUnread!: (value: unknown) => void;
    patchNotificationUnreadMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUnread = resolve;
        }),
    );
    patchNotificationsReadAllMock.mockResolvedValue({ data: { count: 2 } });
    await renderLoaded();
    let pending!: Promise<void>;
    await act(async () => {
      pending = currentNotifications.markUnread("notification-read");
    });
    let pendingAll!: Promise<void>;
    await act(async () => {
      pendingAll = currentNotifications.markAllRead();
    });
    expect(currentNotifications.unreadCount).toBe(0);
    await act(async () => {
      resolveUnread({ data: { ...READ_ROW, isRead: false, readAt: null } });
      await pending;
      await pendingAll;
    });
    expect(
      currentNotifications.notifications.find(
        (row) => row.id === "notification-read",
      )?.isRead,
    ).toBe(true);
    expect(currentNotifications.unreadCount).toBe(0);
  });

  it("a delayed unread event must not undo completed mark all read", async () => {
    patchNotificationUnreadMock.mockResolvedValue({
      data: { ...READ_ROW, isRead: false, readAt: null },
    });
    patchNotificationsReadAllMock.mockResolvedValue({ data: { count: 2 } });
    await renderLoaded();
    await act(async () => {
      await currentNotifications.markUnread(READ_ROW.id);
      await currentNotifications.markAllRead();
    });
    getNotificationsMock.mockResolvedValue({
      data: [{ ...UNREAD_ROW, isRead: true }, READ_ROW],
    });
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 0, needsAction: 0, mentions: 0 },
    });
    await act(async () => {
      useNotificationRealtimeMock.mock.lastCall?.[0].onNotification({
        ...READ_ROW,
        isRead: false,
        readAt: null,
        inApp: true,
        osBanner: false,
        created: false,
      });
    });
    expect(
      currentNotifications.notifications.find((row) => row.id === READ_ROW.id)
        ?.isRead,
    ).toBe(true);
    expect(currentNotifications.unreadCount).toBe(0);
  });

  it("a fetch during queued mark all read must not restore old snapshot", async () => {
    const unread = Promise.withResolvers<unknown>();
    patchNotificationUnreadMock.mockReturnValueOnce(unread.promise);
    patchNotificationsReadAllMock.mockResolvedValue({ data: { count: 2 } });
    await renderLoaded();
    let pending!: Promise<void>;
    let all!: Promise<void>;
    await act(async () => {
      pending = currentNotifications.markUnread(READ_ROW.id);
      all = currentNotifications.markAllRead();
    });
    await act(async () => {
      void currentNotifications.refetch();
    });
    getNotificationsMock.mockResolvedValue({
      data: [{ ...UNREAD_ROW, isRead: true }, READ_ROW],
    });
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 0, needsAction: 0, mentions: 0 },
    });
    await act(async () => {
      unread.resolve({ data: { ...READ_ROW, isRead: false, readAt: null } });
      await Promise.all([pending, all]);
    });
    expect(currentNotifications.unreadCount).toBe(0);
    expect(currentNotifications.notifications.every((row) => row.isRead)).toBe(
      true,
    );
  });

  it("does not apply a fetch started before mark all read", async () => {
    await renderLoaded();
    const stale = Promise.withResolvers<{
      data: (typeof UNREAD_ROW | typeof READ_ROW)[];
    }>();
    getNotificationsMock.mockReturnValueOnce(stale.promise);
    let fetching!: Promise<void>;
    await act(async () => {
      fetching = currentNotifications.refetch();
    });
    patchNotificationsReadAllMock.mockResolvedValue({ data: { count: 1 } });
    getNotificationsMock.mockResolvedValue({
      data: [{ ...UNREAD_ROW, isRead: true }, READ_ROW],
    });
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 0, needsAction: 0, mentions: 0 },
    });
    await act(async () => {
      await currentNotifications.markAllRead();
    });
    await act(async () => {
      stale.resolve({ data: [UNREAD_ROW, READ_ROW] });
      await fetching;
    });
    expect(currentNotifications.unreadCount).toBe(0);
    expect(currentNotifications.notifications.every((row) => row.isRead)).toBe(
      true,
    );
  });

  it("reconciles a genuine unread event from another tab", async () => {
    await renderLoaded();
    getNotificationsMock.mockResolvedValue({
      data: [UNREAD_ROW, { ...READ_ROW, isRead: false, readAt: null }],
    });
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 2, needsAction: 0, mentions: 0 },
    });
    await act(async () => {
      useNotificationRealtimeMock.mock.lastCall?.[0].onNotification({
        ...READ_ROW,
        isRead: false,
        readAt: null,
        inApp: true,
        osBanner: false,
        created: false,
      });
    });
    expect(currentNotifications.unreadCount).toBe(2);
    expect(currentNotifications.notifications.every((row) => !row.isRead)).toBe(
      true,
    );
  });

  it("a read during initial fetch must not discard initial feed", async () => {
    const firstFetch = Promise.withResolvers<unknown>();
    getNotificationsMock.mockReturnValue(firstFetch.promise);
    patchNotificationReadMock.mockResolvedValue({
      data: { ...UNREAD_ROW, isRead: true, readAt: new Date() },
    });
    await renderLoaded();
    await act(async () => {
      await currentNotifications.markRead(UNREAD_ROW.id);
    });
    await act(async () => {
      firstFetch.resolve({ data: [{ ...UNREAD_ROW, isRead: true }, READ_ROW] });
    });
    expect(currentNotifications.notifications).toHaveLength(2);
  });

  it("puts a read row back and adds it to the bell", async () => {
    patchNotificationUnreadMock.mockResolvedValue({
      data: { ...READ_ROW, isRead: false, readAt: null },
    });
    await renderLoaded();
    expect(currentNotifications.unreadCount).toBe(1);

    await act(async () => {
      await currentNotifications.markUnread("notification-read");
    });

    expect(patchNotificationUnreadMock).toHaveBeenCalledWith({
      id: "notification-read",
    });
    expect(currentNotifications.unreadCount).toBe(2);
    expect(
      currentNotifications.notifications.find(
        (row) => row.id === "notification-read",
      )?.isRead,
    ).toBe(false);
  });

  it("leaves the bell alone when the row was already unread", async () => {
    patchNotificationUnreadMock.mockResolvedValue({ data: UNREAD_ROW });
    await renderLoaded();

    await act(async () => {
      await currentNotifications.markUnread("notification-unread");
    });

    expect(currentNotifications.unreadCount).toBe(1);
  });

  it("refetches when putting a row back fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await renderLoaded();
    const fetchCallsBefore = getNotificationsMock.mock.calls.length;
    patchNotificationUnreadMock.mockRejectedValueOnce(new Error("offline"));

    await act(async () => {
      await expect(
        currentNotifications.markUnread("notification-read"),
      ).rejects.toThrow("offline");
    });

    expect(getNotificationsMock.mock.calls.length).toBeGreaterThan(
      fetchCallsBefore,
    );
    consoleError.mockRestore();
  });
});

describe("NotificationProvider paging", () => {
  const NEWEST = {
    id: "notification-newest",
    userId: "user-1",
    kind: "JOB" as const,
    referenceId: "job-1",
    eventId: "event-1",
    messageKey: "Notifications.Job.completed",
    messageParams: {},
    metadata: null,
    isRead: true,
    readAt: new Date("2026-06-18T09:30:00.000Z"),
    createdAt: new Date("2026-06-18T09:00:00.000Z"),
  };
  const OLDEST_LOADED = {
    ...NEWEST,
    id: "notification-oldest-loaded",
    createdAt: new Date("2026-06-18T08:00:00.000Z"),
  };
  const OLDER = {
    ...NEWEST,
    id: "notification-older",
    createdAt: new Date("2026-06-17T08:00:00.000Z"),
  };

  beforeEach(() => {
    getNotificationsMock.mockReset();
    getNotificationsCountsMock.mockReset();
    useNotificationRealtimeMock.mockReset();
    useNotificationFrontPresenceMock.mockReset();
    healPushSubscriptionMock.mockReset();
    healPushSubscriptionMock.mockResolvedValue(false);
    lazyAblyProviderMock.mockReset();
    lazyAblyProviderMock.mockImplementation(
      ({ children }: { children: ReactNode }): ReactNode => <>{children}</>,
    );
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 0, needsAction: 0, mentions: 0 },
    });
    getNotificationsMock.mockResolvedValue({
      data: [NEWEST, OLDEST_LOADED],
      meta: { pagination: { nextCursor: OLDEST_LOADED.id } },
    });
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

  it("asks for the page older than the last row it holds", async () => {
    await renderLoaded();
    expect(currentNotifications.hasMore).toBe(true);

    getNotificationsMock.mockResolvedValue({
      data: [OLDER],
      meta: { pagination: { nextCursor: null } },
    });
    await act(async () => {
      currentNotifications.loadOlder();
      await Promise.resolve();
    });

    expect(getNotificationsMock).toHaveBeenLastCalledWith({
      limit: 20,
      cursor: OLDEST_LOADED.id,
    });
    expect(currentNotifications.notifications.map((row) => row.id)).toEqual([
      NEWEST.id,
      OLDEST_LOADED.id,
      OLDER.id,
    ]);
  });

  it("stops asking once Core has nothing older", async () => {
    await renderLoaded();
    getNotificationsMock.mockResolvedValue({
      data: [OLDER],
      meta: { pagination: { nextCursor: null } },
    });

    await act(async () => {
      currentNotifications.loadOlder();
      await Promise.resolve();
    });

    expect(currentNotifications.hasMore).toBe(false);
    expect(currentNotifications.olderStatus).toBe("idle");
  });

  it("holds a failed page on the row instead of asking again", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await renderLoaded();
    const callsBefore = getNotificationsMock.mock.calls.length;
    getNotificationsMock.mockRejectedValue(new Error("offline"));

    await act(async () => {
      currentNotifications.loadOlder();
      await Promise.resolve();
    });

    expect(currentNotifications.olderStatus).toBe("failed");
    expect(currentNotifications.hasMore).toBe(true);
    expect(getNotificationsMock.mock.calls.length).toBe(callsBefore + 1);

    getNotificationsMock.mockResolvedValue({
      data: [OLDER],
      meta: { pagination: { nextCursor: null } },
    });
    await act(async () => {
      currentNotifications.loadOlder();
      await Promise.resolve();
    });

    expect(currentNotifications.olderStatus).toBe("idle");
    expect(currentNotifications.notifications).toHaveLength(3);
    consoleError.mockRestore();
  });

  it("runs one page request at a time", async () => {
    await renderLoaded();
    const older = Promise.withResolvers<unknown>();
    getNotificationsMock.mockReturnValue(older.promise);
    const callsBefore = getNotificationsMock.mock.calls.length;

    await act(async () => {
      currentNotifications.loadOlder();
      currentNotifications.loadOlder();
      await Promise.resolve();
    });

    expect(getNotificationsMock.mock.calls.length).toBe(callsBefore + 1);

    await act(async () => {
      older.resolve({
        data: [OLDER],
        meta: { pagination: { nextCursor: null } },
      });
      await Promise.resolve();
    });
  });

  it("keeps the pages the reader loaded when a row arrives", async () => {
    await renderLoaded();
    getNotificationsMock.mockResolvedValue({
      data: [OLDER],
      meta: { pagination: { nextCursor: null } },
    });
    await act(async () => {
      currentNotifications.loadOlder();
      await Promise.resolve();
    });

    await act(async () => {
      useNotificationRealtimeMock.mock.lastCall?.[0].onNotification({
        ...NEWEST,
        id: "notification-arrived",
        isRead: false,
        readAt: null,
        createdAt: new Date("2026-06-18T10:00:00.000Z"),
        inApp: true,
        osBanner: false,
        created: true,
      });
    });

    expect(currentNotifications.notifications.map((row) => row.id)).toEqual([
      "notification-arrived",
      NEWEST.id,
      OLDEST_LOADED.id,
      OLDER.id,
    ]);
    expect(currentNotifications.unreadCount).toBe(1);
  });

  it("keeps rows below the refreshed page when a refresh lands", async () => {
    await renderLoaded();
    getNotificationsMock.mockResolvedValue({
      data: [OLDER],
      meta: { pagination: { nextCursor: null } },
    });
    await act(async () => {
      currentNotifications.loadOlder();
      await Promise.resolve();
    });

    getNotificationsMock.mockResolvedValue({
      data: [NEWEST, OLDEST_LOADED],
      meta: { pagination: { nextCursor: OLDEST_LOADED.id } },
    });
    await act(async () => {
      await currentNotifications.refetch();
    });

    expect(currentNotifications.notifications.map((row) => row.id)).toEqual([
      NEWEST.id,
      OLDEST_LOADED.id,
      OLDER.id,
    ]);
  });

  it("drops an in-flight older page when a refresh starts the list over", async () => {
    await renderLoaded();
    const older = Promise.withResolvers<unknown>();
    getNotificationsMock.mockReturnValueOnce(older.promise);

    await act(async () => {
      currentNotifications.loadOlder();
      await Promise.resolve();
    });

    const arrived = {
      ...NEWEST,
      id: "notification-arrived",
      createdAt: new Date("2026-06-18T11:00:00.000Z"),
    };
    const arrivedOldest = {
      ...NEWEST,
      id: "notification-arrived-oldest",
      createdAt: new Date("2026-06-18T10:00:00.000Z"),
    };
    getNotificationsMock.mockResolvedValue({
      data: [arrived, arrivedOldest],
      meta: { pagination: { nextCursor: arrivedOldest.id } },
    });
    await act(async () => {
      await currentNotifications.refetch();
    });

    await act(async () => {
      older.resolve({
        data: [OLDER],
        meta: { pagination: { nextCursor: null } },
      });
      await Promise.resolve();
    });

    expect(currentNotifications.notifications.map((row) => row.id)).toEqual([
      arrived.id,
      arrivedOldest.id,
    ]);
    expect(currentNotifications.hasMore).toBe(true);
    expect(currentNotifications.olderStatus).toBe("idle");
  });

  it("follows Core's own cursor when a page adds nothing new", async () => {
    await renderLoaded();
    // The oldest row moved to the top on the server and the event that said
    // so never arrived, so paging from it returns rows this list already has.
    getNotificationsMock.mockResolvedValue({
      data: [NEWEST],
      meta: { pagination: { nextCursor: "server-next" } },
    });
    await act(async () => {
      currentNotifications.loadOlder();
      await Promise.resolve();
    });

    getNotificationsMock.mockResolvedValue({
      data: [OLDER],
      meta: { pagination: { nextCursor: null } },
    });
    await act(async () => {
      currentNotifications.loadOlder();
      await Promise.resolve();
    });

    expect(getNotificationsMock).toHaveBeenLastCalledWith({
      limit: 20,
      cursor: "server-next",
    });
    expect(currentNotifications.notifications.at(-1)?.id).toBe(OLDER.id);
  });

  it("drops a row Core no longer lists when it refuses it as a cursor", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await renderLoaded();
    getNotificationsMock.mockRejectedValue(
      new CoreApiRequestError("Invalid pagination cursor", { status: 400 }),
    );

    await act(async () => {
      currentNotifications.loadOlder();
      await Promise.resolve();
    });

    expect(currentNotifications.notifications.map((row) => row.id)).toEqual([
      NEWEST.id,
    ]);
    expect(currentNotifications.olderStatus).toBe("idle");

    // A second refusal in a row is not a stale row any more; it waits for
    // the reader instead of draining the list one request at a time.
    await act(async () => {
      currentNotifications.loadOlder();
      await Promise.resolve();
    });

    expect(getNotificationsMock).toHaveBeenLastCalledWith({
      limit: 20,
      cursor: NEWEST.id,
    });
    expect(currentNotifications.notifications).toHaveLength(1);
    expect(currentNotifications.olderStatus).toBe("failed");
    consoleError.mockRestore();
  });

  it("lets a reader's retry drop one more row Core refuses", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    getNotificationsMock.mockResolvedValue({
      data: [NEWEST, OLDEST_LOADED, OLDER],
      meta: { pagination: { nextCursor: OLDER.id } },
    });
    await renderLoaded();
    getNotificationsMock.mockRejectedValue(
      new CoreApiRequestError("Invalid pagination cursor", { status: 400 }),
    );

    // Two rows at the end have both left the feed.
    await act(async () => {
      currentNotifications.loadOlder();
      await Promise.resolve();
    });
    await act(async () => {
      currentNotifications.loadOlder();
      await Promise.resolve();
    });
    expect(currentNotifications.olderStatus).toBe("failed");
    expect(currentNotifications.notifications).toHaveLength(2);

    await act(async () => {
      currentNotifications.loadOlder();
      await Promise.resolve();
    });

    expect(currentNotifications.notifications.map((row) => row.id)).toEqual([
      NEWEST.id,
    ]);
    expect(currentNotifications.olderStatus).toBe("idle");
    consoleError.mockRestore();
  });

  it("stays failed through a refresh until the reader retries", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await renderLoaded();
    getNotificationsMock.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      currentNotifications.loadOlder();
      await Promise.resolve();
    });
    expect(currentNotifications.olderStatus).toBe("failed");

    await act(async () => {
      await currentNotifications.refetch();
    });

    expect(currentNotifications.olderStatus).toBe("failed");
    consoleError.mockRestore();
  });
});

describe("NotificationProvider failed read writes", () => {
  const UNREAD = {
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
  const READ = {
    ...UNREAD,
    id: "notification-read",
    isRead: true,
    readAt: new Date("2026-06-18T08:30:00.000Z"),
    createdAt: new Date("2026-06-18T08:00:00.000Z"),
  };

  beforeEach(() => {
    getNotificationsMock.mockReset();
    getNotificationsCountsMock.mockReset();
    patchNotificationReadMock.mockReset();
    patchNotificationUnreadMock.mockReset();
    useNotificationRealtimeMock.mockReset();
    useNotificationFrontPresenceMock.mockReset();
    healPushSubscriptionMock.mockReset();
    healPushSubscriptionMock.mockResolvedValue(false);
    lazyAblyProviderMock.mockReset();
    lazyAblyProviderMock.mockImplementation(
      ({ children }: { children: ReactNode }): ReactNode => <>{children}</>,
    );
    getNotificationsMock.mockResolvedValue({ data: [UNREAD, READ] });
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 1, needsAction: 0, mentions: 0 },
    });
  });

  async function renderOffline() {
    render(
      <NotificationProvider userId="user-1">
        <NotificationConsumer />
      </NotificationProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    // From here on nothing reaches Core, so the recovery read fails too.
    getNotificationsMock.mockRejectedValue(new Error("offline"));
    getNotificationsCountsMock.mockRejectedValue(new Error("offline"));
  }

  it("puts a row back to unread when marking it read fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await renderOffline();
    patchNotificationReadMock.mockRejectedValue(new Error("offline"));

    await act(async () => {
      await expect(currentNotifications.markRead(UNREAD.id)).rejects.toThrow(
        "offline",
      );
    });

    expect(
      currentNotifications.notifications.find((row) => row.id === UNREAD.id)
        ?.isRead,
    ).toBe(false);
    expect(currentNotifications.unreadCount).toBe(1);
    consoleError.mockRestore();
  });

  it("puts a row back to read when marking it unread fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await renderOffline();
    patchNotificationUnreadMock.mockRejectedValue(new Error("offline"));

    await act(async () => {
      await expect(currentNotifications.markUnread(READ.id)).rejects.toThrow(
        "offline",
      );
    });

    expect(
      currentNotifications.notifications.find((row) => row.id === READ.id)
        ?.isRead,
    ).toBe(true);
    expect(currentNotifications.unreadCount).toBe(1);
    consoleError.mockRestore();
  });

  it("leaves a row alone when a failed read never changed it", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await renderOffline();
    patchNotificationReadMock.mockRejectedValue(new Error("offline"));

    // A toast or a push window can ask to read a row that is read already.
    await act(async () => {
      await currentNotifications.markRead(READ.id).catch(() => {});
    });

    expect(
      currentNotifications.notifications.find((row) => row.id === READ.id)
        ?.isRead,
    ).toBe(true);
    expect(currentNotifications.unreadCount).toBe(1);
    consoleError.mockRestore();
  });
});
