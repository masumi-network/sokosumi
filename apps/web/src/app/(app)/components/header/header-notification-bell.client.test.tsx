import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HeaderNotificationBell } from "@/app/components/header/header-notification-bell.client";

const useNotificationsMock = vi.fn();
const useAccountNoticeMock = vi.fn();
const markManyReadMock = vi.fn();

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

vi.mock("@/app/components/header/notification-dropdown-content", () => ({
  NotificationDropdownContent: ({
    onClose,
    onClearAll,
  }: {
    onClose: () => void;
    onClearAll: () => void;
  }) => (
    <div data-testid="notification-dropdown-content">
      <button
        type="button"
        onClick={() => {
          onClose();
          onClearAll();
        }}
      >
        clear-all
      </button>
      <button type="button" onClick={onClose}>
        close-panel
      </button>
    </div>
  ),
}));

describe("HeaderNotificationBell", () => {
  beforeEach(() => {
    useNotificationsMock.mockReset();
    useAccountNoticeMock.mockReset();
    markManyReadMock.mockReset();
    markManyReadMock.mockResolvedValue(undefined);
    useNotificationsMock.mockReturnValue({
      unreadCount: 0,
      notifications: [],
      markManyRead: markManyReadMock,
    });
    useAccountNoticeMock.mockReturnValue({ notice: null });
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
      markManyRead: markManyReadMock,
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
      screen.getByTestId("notification-dropdown-content"),
    ).toBeInTheDocument();
  });

  it("marks the rows it showed read when the panel closes", async () => {
    useNotificationsMock.mockReturnValue({
      unreadCount: 2,
      notifications: [
        notificationRow("notif_unread_1", false),
        notificationRow("notif_already_read", true),
        notificationRow("notif_unread_2", false),
      ],
      markManyRead: markManyReadMock,
    });
    const user = userEvent.setup();
    render(<HeaderNotificationBell />);

    await user.click(
      screen.getByRole("button", { name: "2 unread notifications" }),
    );
    expect(markManyReadMock).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(markManyReadMock).toHaveBeenCalledWith([
        "notif_unread_1",
        "notif_unread_2",
      ]),
    );
  });

  it("does not write when the open panel held nothing unread", async () => {
    useNotificationsMock.mockReturnValue({
      unreadCount: 0,
      notifications: [notificationRow("notif_already_read", true)],
      markManyRead: markManyReadMock,
    });
    const user = userEvent.setup();
    render(<HeaderNotificationBell />);

    await user.click(screen.getByRole("button", { name: "Notifications" }));
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.queryByTestId("notification-dropdown-content"),
      ).not.toBeInTheDocument(),
    );
    expect(markManyReadMock).toHaveBeenCalledWith([]);
  });
});

it("restores focus to the bell after canceling clear", async () => {
  useNotificationsMock.mockReturnValue({
    unreadCount: 0,
    notifications: [],
    markManyRead: markManyReadMock,
  });
  useAccountNoticeMock.mockReturnValue({ notice: null });
  const user = userEvent.setup();
  render(<HeaderNotificationBell />);
  const bell = screen.getByRole("button", { name: "Notifications" });
  await user.click(bell);
  await user.click(screen.getByRole("button", { name: "clear-all" }));
  await user.click(screen.getByRole("button", { name: "cancel" }));
  await waitFor(() => expect(bell).toHaveFocus());
});
