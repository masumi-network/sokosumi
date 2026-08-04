import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationItem } from "@/app/components/header/notification-item";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NotificationItem as NotificationItemType } from "@/lib/clients/generated/core";
import { VENDOR_GRANT_PENDING_MESSAGE_KEY } from "@/lib/utils/vendor-grant-notification";

const approveMyVendorGrantMock = vi.fn();
const approveOrganizationVendorGrantMock = vi.fn();
const markReadMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/contexts/notification-provider", () => ({
  useNotifications: () => ({
    markRead: markReadMock,
  }),
}));

vi.mock("@/lib/actions/account/vendor-grant-action", () => ({
  approveMyVendorGrant: (...args: unknown[]) =>
    approveMyVendorGrantMock(...args),
}));

vi.mock("@/lib/actions/organization/vendor-grant-action", () => ({
  approveOrganizationVendorGrant: (...args: unknown[]) =>
    approveOrganizationVendorGrantMock(...args),
}));

function createPendingVendorGrantNotification(
  overrides: Partial<NotificationItemType> = {},
): NotificationItemType {
  return {
    id: "notification-grant-1",
    userId: "user-1",
    kind: "SYSTEM",
    referenceId: "grant-1",
    eventId: "event-1",
    messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
    messageParams: {},
    metadata: { vendorId: "vendor-1" },
    isRead: false,
    readAt: null,
    createdAt: new Date("2026-06-18T09:00:00.000Z"),
    ...overrides,
  };
}

function renderInOpenDropdown(
  notification: NotificationItemType,
  onClick: () => void,
) {
  return render(
    <DropdownMenu open>
      <DropdownMenuTrigger asChild>
        <button type="button">Open</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <NotificationItem
          notification={notification}
          onClick={onClick}
          formatTime={() => "just now"}
        />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
}

describe("NotificationItem vendor-grant Accept", () => {
  beforeEach(() => {
    approveMyVendorGrantMock.mockReset();
    approveOrganizationVendorGrantMock.mockReset();
    markReadMock.mockReset();
    approveMyVendorGrantMock.mockResolvedValue({ ok: true, data: {} });
    markReadMock.mockResolvedValue(undefined);
  });

  it("does not fire row navigation onClick when Accept is clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const notification = createPendingVendorGrantNotification();

    renderInOpenDropdown(notification, onClick);

    const acceptButton = await screen.findByRole("button", { name: "accept" });
    await user.click(acceptButton);

    await waitFor(() => {
      expect(approveMyVendorGrantMock).toHaveBeenCalledWith({
        grantId: "grant-1",
      });
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("fires row navigation onClick when the message is clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const notification = createPendingVendorGrantNotification();

    renderInOpenDropdown(notification, onClick);

    await user.click(
      screen.getByRole("button", {
        name: new RegExp(VENDOR_GRANT_PENDING_MESSAGE_KEY),
      }),
    );

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
