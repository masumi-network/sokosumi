import { act, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NotificationProvider,
  useNotifications,
} from "@/contexts/notification-provider";

const getNotificationsMock = vi.fn();
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
    patchNotificationRead: vi.fn(),
    patchNotificationsReadAll: vi.fn(),
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

function NotificationConsumer() {
  const { isLoading, hasFetchError, unreadCount } = useNotifications();

  return (
    <div data-testid="notification-consumer">
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="fetch-error">{String(hasFetchError)}</span>
      <span data-testid="unread-count">{unreadCount}</span>
    </div>
  );
}

describe("NotificationProvider island", () => {
  beforeEach(() => {
    getNotificationsMock.mockReset();
    getNotificationsUnreadCountMock.mockReset();
    useNotificationRealtimeMock.mockReset();
    lazyAblyProviderMock.mockReset();
    lazyAblyProviderMock.mockImplementation(
      ({ children }: { children: ReactNode }): ReactNode => <>{children}</>,
    );

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
  };

  it("counts a delivered notification the moment it arrives", async () => {
    await emit(REALTIME_EVENT);

    expect(screen.getByTestId("unread-count")).toHaveTextContent("1");
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
