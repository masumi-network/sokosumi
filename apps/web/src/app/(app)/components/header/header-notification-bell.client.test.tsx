import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HeaderNotificationBell } from "@/app/components/header/header-notification-bell.client";

const useNotificationsMock = vi.fn();
const useAccountNoticeMock = vi.fn();

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
  NotificationDropdownContent: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="notification-dropdown-content">
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
    useNotificationsMock.mockReturnValue({ unreadCount: 0 });
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
    useNotificationsMock.mockReturnValue({ unreadCount: 12 });

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
});
