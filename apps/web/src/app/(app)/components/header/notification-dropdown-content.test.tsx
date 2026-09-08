import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { NotificationDropdownContent } from "@/app/components/header/notification-dropdown-content";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/contexts/notification-provider", () => ({
  useNotifications: () => ({
    notifications: [{ id: "notification-1", createdAt: new Date() }],
    unreadCount: 0,
    isLoading: false,
    hasFetchError: false,
  }),
}));

vi.mock("@/contexts/account-notice-provider", () => ({
  useAccountNotice: () => ({ notice: null }),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: null }),
}));

vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: () => ({ handleSelectWorkspace: vi.fn() }),
}));

vi.mock("@/app/components/account-notice-row", () => ({
  AccountNoticeRow: () => null,
}));

vi.mock("@/app/components/notification-browser-permission-primer", () => ({
  NotificationBrowserPermissionPrimer: () => null,
}));

vi.mock("@/lib/utils/notification-navigation", () => ({
  handleNotificationNavigation: vi.fn(),
}));

vi.mock("@/lib/utils/notification-time", () => ({
  useNotificationTimeFormatter: () => () => "",
}));

vi.mock("@/app/components/header/notification-item", () => ({
  NotificationItem: () => <DropdownMenuItem>Notification</DropdownMenuItem>,
}));

it("reaches Clear all with arrow keys and opens confirmation with Enter", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const onClearAll = vi.fn();

  render(
    <DropdownMenu>
      <DropdownMenuTrigger>Open notifications</DropdownMenuTrigger>
      <DropdownMenuContent>
        <NotificationDropdownContent
          onClose={onClose}
          onClearAll={onClearAll}
        />
      </DropdownMenuContent>
    </DropdownMenu>,
  );

  screen.getByRole("button", { name: "Open notifications" }).focus();
  await user.keyboard("{Enter}");

  const clearAll = await screen.findByText("clearAll");
  await waitFor(() => expect(clearAll).toHaveFocus());
  expect(clearAll).toHaveAttribute("role", "menuitem");

  await user.keyboard("{ArrowDown}");
  await waitFor(() =>
    expect(
      screen.getByRole("menuitem", { name: "Notification" }),
    ).toHaveFocus(),
  );
  await user.keyboard("{ArrowUp}");
  await waitFor(() => expect(clearAll).toHaveFocus());
  await user.keyboard("{Enter}");

  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onClearAll).toHaveBeenCalledTimes(1);
});
