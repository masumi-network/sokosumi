import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NotificationProvider,
  useNotifications,
} from "@/contexts/notification-provider";

const getNotificationsMock = vi.fn();
const getNotificationsUnreadCountMock = vi.fn();
const useNotificationRealtimeMock = vi.fn();

const lazyAblyProviderMock = vi.fn(
  ({ children }: { children: React.ReactNode }): React.ReactNode => (
    <>{children}</>
  ),
);

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
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
  ChannelProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="notifications-channel-provider">{children}</div>
  ),
}));

vi.mock("@/contexts/lazy-ably-provider", () => ({
  default: (props: { children: React.ReactNode }) =>
    lazyAblyProviderMock(props),
}));

vi.mock("@/app/components/notification-toast-listener", () => ({
  NotificationToastListener: ({ userId }: { userId: string }) => (
    <div data-testid="notification-toast-listener">{userId}</div>
  ),
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
      ({ children }: { children: React.ReactNode }): React.ReactNode => (
        <>{children}</>
      ),
    );

    getNotificationsMock.mockResolvedValue({ data: [] });
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 0 } });
  });

  it("renders children and REST context without waiting on Ably", async () => {
    lazyAblyProviderMock.mockImplementation((): React.ReactNode => null);

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

  it("surfaces fetch errors on the immediate path without Ably", async () => {
    lazyAblyProviderMock.mockImplementation((): React.ReactNode => null);
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
});
