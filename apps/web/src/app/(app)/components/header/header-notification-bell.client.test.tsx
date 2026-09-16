import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HeaderNotificationBell } from "@/app/components/header/header-notification-bell.client";

const useNotificationsMock = vi.fn();
const useAccountNoticeMock = vi.fn();
const isMobileMock = vi.fn();

function notificationRow(id: string, isRead: boolean) {
  return { id, isRead };
}

vi.mock("next-intl", () => ({
  useTranslations: () => {
    return (key: string, values?: { count?: number }) => {
      if (key === "unreadBadge") {
        return `${values?.count ?? 0} unread notifications`;
      }
      if (key === "unreadBadgeWithAccountNotice") {
        return `${values?.count ?? 0} unread notifications and account notice`;
      }
      if (key === "accountNoticeIndicator") {
        return "Account notice";
      }
      if (key === "notifications") {
        return "Notifications";
      }
      return key;
    };
  },
}));

vi.mock("@/contexts/notification-provider", () => ({
  useNotifications: () => useNotificationsMock(),
}));

vi.mock("@/contexts/account-notice-provider", () => ({
  useAccountNotice: () => useAccountNoticeMock(),
}));

vi.mock("@/app/components/header/notification-panel-content", () => ({
  NotificationPanelContent: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="notification-panel-content">
      <button type="button" onClick={onClose}>
        close-panel
      </button>
    </div>
  ),
}));

vi.mock("@/hooks/use-mobile", () => ({
  MOBILE_BREAKPOINT: 768,
  useIsMobile: () => isMobileMock(),
  useIsMobileMedia: () => isMobileMock(),
}));

/** The popover's own element, which carries the panel's width. */
function panelClassName(): string {
  const panel = screen
    .getByTestId("notification-panel-content")
    .closest("[data-slot='popover-content']");
  return panel?.className ?? "";
}

const markReadMock = vi.fn();
const markAllReadMock = vi.fn();

describe("HeaderNotificationBell", () => {
  beforeEach(() => {
    useNotificationsMock.mockReset();
    markReadMock.mockReset();
    markAllReadMock.mockReset();
    useAccountNoticeMock.mockReset();
    isMobileMock.mockReset();
    isMobileMock.mockReturnValue(false);
    useNotificationsMock.mockReturnValue({
      unreadCount: 0,
      notifications: [],
      markRead: markReadMock,
      markAllRead: markAllReadMock,
    });
    useAccountNoticeMock.mockReturnValue({ notice: null });
  });

  it("keeps the badge while the panel is open, because opening reads nothing", async () => {
    // The badge counts unread rows. Opening the panel does not read them any
    // more, so hiding the count while open would state a clear that no write
    // backs, and the number would come straight back on close.
    useNotificationsMock.mockReturnValue({
      unreadCount: 2,
      notifications: [
        notificationRow("n1", false),
        notificationRow("n2", false),
      ],
      markRead: markReadMock,
      markAllRead: markAllReadMock,
    });
    const user = userEvent.setup();
    render(<HeaderNotificationBell />);
    await user.click(
      screen.getByRole("button", { name: "2 unread notifications" }),
    );
    expect(
      screen.getByTestId("notification-panel-content"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("notification-unread-badge")).toHaveTextContent(
      "2",
    );
  });

  it("gives the panel the same width whatever the unread count is", async () => {
    // The panel used to narrow the moment the count reached zero. Each row
    // now carries its own mark read control, so the reader would watch the
    // panel resize under their cursor as they cleared the last unread row.
    const user = userEvent.setup();

    useNotificationsMock.mockReturnValue({
      unreadCount: 2,
      notifications: [
        notificationRow("n1", false),
        notificationRow("n2", false),
      ],
      markRead: markReadMock,
      markAllRead: markAllReadMock,
    });
    const withUnread = render(<HeaderNotificationBell />);
    await user.click(
      screen.getByRole("button", { name: "2 unread notifications" }),
    );
    const withUnreadClassName = panelClassName();
    withUnread.unmount();

    useNotificationsMock.mockReturnValue({
      unreadCount: 0,
      notifications: [notificationRow("n1", true)],
      markRead: markReadMock,
      markAllRead: markAllReadMock,
    });
    render(<HeaderNotificationBell />);
    await user.click(screen.getByRole("button", { name: "Notifications" }));

    expect(panelClassName()).toBe(withUnreadClassName);
  });

  it("renders a notifications control with tooltip copy as the accessible name", () => {
    render(<HeaderNotificationBell />);

    expect(
      screen.getByRole("button", { name: "Notifications" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("notification-unread-badge"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("notification-account-notice-dot"),
    ).not.toBeInTheDocument();
  });

  it("shows a capped count badge when there are unread notifications", () => {
    useNotificationsMock.mockReturnValue({
      unreadCount: 12,
      notifications: [],
      markRead: markReadMock,
      markAllRead: markAllReadMock,
    });

    render(<HeaderNotificationBell />);

    expect(
      screen.getByRole("button", { name: "12 unread notifications" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("notification-unread-badge")).toHaveTextContent(
      "9+",
    );
  });

  it("shows a notice dot when only an account notice is active", () => {
    useAccountNoticeMock.mockReturnValue({
      notice: { tone: "warning" },
    });

    render(<HeaderNotificationBell />);

    expect(
      screen.getByRole("button", { name: "Account notice" }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("notification-account-notice-dot"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("notification-unread-badge"),
    ).not.toBeInTheDocument();
  });

  it("opens the notification panel on click", async () => {
    const user = userEvent.setup();
    render(<HeaderNotificationBell />);

    await user.click(screen.getByRole("button", { name: "Notifications" }));

    expect(
      screen.getByTestId("notification-panel-content"),
    ).toBeInTheDocument();
  });

  it("writes no read when the reader dismisses the panel", async () => {
    // The panel used to commit a read for every row it had shown. It no
    // longer decides for the reader: each row carries its own control.
    useNotificationsMock.mockReturnValue({
      unreadCount: 2,
      notifications: [
        notificationRow("notif_unread_1", false),
        notificationRow("notif_already_read", true),
        notificationRow("notif_unread_2", false),
      ],
      markRead: markReadMock,
      markAllRead: markAllReadMock,
    });
    const user = userEvent.setup();
    render(<HeaderNotificationBell />);

    await user.click(
      screen.getByRole("button", { name: "2 unread notifications" }),
    );
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.queryByTestId("notification-panel-content"),
      ).not.toBeInTheDocument(),
    );
    expect(markReadMock).not.toHaveBeenCalled();
    expect(markAllReadMock).not.toHaveBeenCalled();
  });

  it("writes no read when a child closes the panel instead of the reader", async () => {
    // "View all" and the permission primer close through onClose, which
    // writes `open` from the parent. That path must stay silent too.
    useNotificationsMock.mockReturnValue({
      unreadCount: 1,
      notifications: [notificationRow("notif_unread_1", false)],
      markRead: markReadMock,
      markAllRead: markAllReadMock,
    });
    const user = userEvent.setup();
    render(<HeaderNotificationBell />);

    await user.click(
      screen.getByRole("button", { name: "1 unread notifications" }),
    );
    await user.click(screen.getByRole("button", { name: "close-panel" }));

    await waitFor(() =>
      expect(
        screen.queryByTestId("notification-panel-content"),
      ).not.toBeInTheDocument(),
    );
    expect(markReadMock).not.toHaveBeenCalled();
    expect(markAllReadMock).not.toHaveBeenCalled();
  });
});
