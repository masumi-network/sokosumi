import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
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
const removeNotificationMock = vi.fn();
const deleteNotificationMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const parts = values ? Object.values(values).map(String) : [];

    return parts.length > 0 ? `${key} ${parts.join(" ")}` : key;
  },
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
    removeNotification: removeNotificationMock,
    deleteNotification: deleteNotificationMock,
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
    removeNotificationMock.mockReset();
    deleteNotificationMock.mockReset();
    deleteNotificationMock.mockResolvedValue(undefined);
    approveMyVendorGrantMock.mockResolvedValue({
      ok: true,
      value: { grantId: "grant-1" },
    });
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
    expect(removeNotificationMock).toHaveBeenCalledWith("notification-grant-1");
  });

  it("does not render a dismiss button", async () => {
    const notification = createPendingVendorGrantNotification();

    renderInOpenDropdown(notification, vi.fn());

    expect(
      await screen.findByRole("button", { name: "accept" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "dismiss" })).toBeNull();
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

function createJobNotification(
  overrides: Partial<NotificationItemType> = {},
): NotificationItemType {
  return {
    id: "notification-job-1",
    userId: "user-1",
    kind: "JOB",
    referenceId: "job-1",
    eventId: "event-1",
    messageKey: "Notifications.Job.completed",
    messageParams: {},
    metadata: null,
    isRead: false,
    readAt: null,
    createdAt: new Date("2026-06-18T09:00:00.000Z"),
    ...overrides,
  };
}

describe("NotificationItem delete", () => {
  beforeEach(() => {
    deleteNotificationMock.mockReset();
    deleteNotificationMock.mockResolvedValue(undefined);
    vi.mocked(toast.error).mockReset();
  });

  it("deletes the notification without opening it", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    renderInOpenDropdown(createJobNotification(), onClick);

    await user.click(await screen.findByRole("menuitem", { name: /^delete/ }));

    await waitFor(() => {
      expect(deleteNotificationMock).toHaveBeenCalledWith("notification-job-1");
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("names the row each control removes", async () => {
    renderInOpenDropdown(createJobNotification(), vi.fn());

    expect(
      await screen.findByRole("menuitem", {
        name: /^delete .*Notifications\.Job\.completed/,
      }),
    ).toBeInTheDocument();
  });

  it("offers the control on a pending access request too", async () => {
    renderInOpenDropdown(createPendingVendorGrantNotification(), vi.fn());

    expect(
      await screen.findByRole("menuitem", { name: /^delete/ }),
    ).toBeInTheDocument();
  });

  it("tells the reader when the delete fails", async () => {
    const user = userEvent.setup();
    deleteNotificationMock.mockRejectedValue(new Error("network down"));

    renderInOpenDropdown(createJobNotification(), vi.fn());

    await user.click(await screen.findByRole("menuitem", { name: /^delete/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("deleteError");
    });
  });
});
