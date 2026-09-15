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
const markUnreadMock = vi.fn();
const markReadMock = vi.fn();

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
    markUnread: markUnreadMock,
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
    removeNotificationMock.mockReset();
    deleteNotificationMock.mockReset();
    deleteNotificationMock.mockResolvedValue(undefined);
    markUnreadMock.mockReset();
    markUnreadMock.mockResolvedValue(undefined);
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
      expect(deleteNotificationMock).toHaveBeenCalledWith(
        "notification-job-1",
        { isRead: false },
      );
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

  it("explains the control on hover, in words", async () => {
    // A bin glyph is a guess until something says what it does.
    const user = userEvent.setup();

    renderInOpenDropdown(createJobNotification(), vi.fn());

    await user.hover(await screen.findByRole("menuitem", { name: /^delete/ }));

    expect(await screen.findByText("deleteTooltip")).toBeInTheDocument();
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

describe("NotificationItem mark unread", () => {
  beforeEach(() => {
    markUnreadMock.mockReset();
    markUnreadMock.mockResolvedValue(undefined);
  });

  it("offers the way back on a read row and puts it back when used", async () => {
    const user = userEvent.setup();
    const notification = createJobNotification({
      id: "notification-read",
      isRead: true,
      readAt: new Date("2026-06-18T09:30:00.000Z"),
    });

    renderInOpenDropdown(notification, vi.fn());

    const control = await screen.findByRole("menuitem", {
      name: /markUnread/,
    });
    await user.click(control);

    await waitFor(() =>
      expect(markUnreadMock).toHaveBeenCalledWith("notification-read"),
    );
  });

  it("offers it on a read row that carries pending access actions too", async () => {
    // That branch renders its own row shape, so the control has to be placed
    // in both or it goes missing on exactly the rows a reader lingers over.
    const notification = createPendingVendorGrantNotification({
      isRead: true,
      readAt: new Date("2026-06-18T09:30:00.000Z"),
    });

    renderInOpenDropdown(notification, vi.fn());

    expect(
      await screen.findByRole("menuitem", { name: /markUnread/ }),
    ).toBeInTheDocument();
  });

  it("explains the control on hover, in words", async () => {
    // An envelope is a guess until something says what it does. The tooltip
    // is the only explanation a sighted mouse user gets.
    const user = userEvent.setup();

    renderInOpenDropdown(
      createJobNotification({
        isRead: true,
        readAt: new Date("2026-06-18T09:30:00.000Z"),
      }),
      vi.fn(),
    );

    await user.hover(
      await screen.findByRole("menuitem", { name: /markUnread/ }),
    );

    expect(await screen.findByText("markUnreadTooltip")).toBeInTheDocument();
  });

  it("does not offer it on a row that is already unread", async () => {
    const notification = createJobNotification();

    renderInOpenDropdown(notification, vi.fn());

    await screen.findByRole("menuitem", { name: /delete/ });
    expect(screen.queryByRole("menuitem", { name: /markUnread/ })).toBeNull();
  });
});
describe("NotificationItem mark read", () => {
  beforeEach(() => {
    markReadMock.mockReset();
    markReadMock.mockResolvedValue(undefined);
    markUnreadMock.mockReset();
    markUnreadMock.mockResolvedValue(undefined);
  });

  it("clears one unread row without opening it or closing the panel", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    renderInOpenDropdown(createJobNotification(), onClick);

    await user.click(
      await screen.findByRole("menuitem", { name: /^markRead/ }),
    );

    await waitFor(() =>
      expect(markReadMock).toHaveBeenCalledWith("notification-job-1"),
    );
    // Opening the row navigates away. Clearing it must not.
    expect(onClick).not.toHaveBeenCalled();
  });

  it("names the row the control acts on", async () => {
    renderInOpenDropdown(createJobNotification(), vi.fn());

    expect(
      await screen.findByRole("menuitem", {
        name: /^markRead .*Notifications\.Job\.completed/,
      }),
    ).toBeInTheDocument();
  });

  it("offers it on an unread row with pending access actions too", async () => {
    renderInOpenDropdown(createPendingVendorGrantNotification(), vi.fn());

    expect(
      await screen.findByRole("menuitem", { name: /^markRead/ }),
    ).toBeInTheDocument();
  });

  it("explains the control on hover, in words", async () => {
    // An envelope is a guess until something says what it does.
    const user = userEvent.setup();

    renderInOpenDropdown(createJobNotification(), vi.fn());

    await user.hover(
      await screen.findByRole("menuitem", { name: /^markRead/ }),
    );

    expect(await screen.findByText("markReadTooltip")).toBeInTheDocument();
  });

  it("gives a read row the way back instead, never both", async () => {
    // One state, one move. Two controls would make the reader choose between
    // an action and its undo on a row that is only ever in one of them.
    renderInOpenDropdown(
      createJobNotification({
        isRead: true,
        readAt: new Date("2026-06-18T09:30:00.000Z"),
      }),
      vi.fn(),
    );

    expect(
      await screen.findByRole("menuitem", { name: /markUnread/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^markRead/ })).toBeNull();
  });
});

describe("NotificationItem unread indicator", () => {
  it("carries the accent bar on an unread row and names the state", async () => {
    renderInOpenDropdown(createJobNotification(), vi.fn());

    const row = await screen.findByRole("group");
    const rail = row.firstElementChild;

    expect(rail?.className).toContain("bg-primary");
    // The geometry is the half that must not move between states: a rail
    // that changes width, collapses under a long message, or renders with no
    // height puts the reflow back.
    expect(rail?.className).toContain("w-0.5");
    expect(rail?.className).toContain("shrink-0");
    expect(rail?.className).toContain("self-stretch");
    // Forced colors repaints bg-primary as Canvas, the row's own colour, so
    // the rail carries a system colour that mode leaves alone.
    expect(rail?.className).toContain("forced-colors:bg-[Highlight]");
    // The bar and the icon tint are colour, so the state is also text.
    const state = screen.getByText("unreadIndicator");
    // Hidden from sight, or the row says "Unread" twice over to everyone else.
    expect(state.className).toContain("sr-only");
    // Ahead of the message, so the state frames what follows rather than
    // trailing it. DOCUMENT_POSITION_FOLLOWING means the message comes after.
    const message = screen.getByText(/Notifications\.Job\.completed/);
    expect(state.compareDocumentPosition(message)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("keeps the bar's width on a read row, in transparent, and says nothing", async () => {
    // The width has to stay, or the message shifts sideways the moment a row
    // is read under the reader's cursor.
    renderInOpenDropdown(
      createJobNotification({
        isRead: true,
        readAt: new Date("2026-06-18T09:30:00.000Z"),
      }),
      vi.fn(),
    );

    const row = await screen.findByRole("group");
    const rail = row.firstElementChild;

    // The rail keeps the same geometry as the unread one, so the message
    // does not slide sideways or re-wrap when the row changes state.
    expect(rail?.className).toContain("w-0.5");
    expect(rail?.className).toContain("shrink-0");
    expect(rail?.className).toContain("self-stretch");
    // Transparent as a background, not a border: forced colors mode keeps a
    // background's alpha and would repaint a transparent border outright.
    expect(rail?.className).toContain("bg-transparent");
    expect(rail?.className).not.toContain("bg-primary");
    expect(screen.queryByText("unreadIndicator")).toBeNull();
  });

  it("draws the message at one weight in both states", async () => {
    // A heavier unread message re-wraps the moment the row is marked read,
    // and every row below it moves. The bar carries the state instead.
    const unread = renderInOpenDropdown(createJobNotification(), vi.fn());
    const unreadClassName = (
      await screen.findByText(/Notifications\.Job\.completed/)
    ).className;
    unread.unmount();

    renderInOpenDropdown(
      createJobNotification({
        isRead: true,
        readAt: new Date("2026-06-18T09:30:00.000Z"),
      }),
      vi.fn(),
    );
    const readClassName = (
      await screen.findByText(/Notifications\.Job\.completed/)
    ).className;

    expect(unreadClassName).toBe(readClassName);
    // Both empty would satisfy the line above and prove nothing.
    expect(unreadClassName).toContain("text-sm");
    // Any weight utility at all would reintroduce the reflow.
    expect(unreadClassName).not.toMatch(/font-/);
  });

  it("carries both on an unread row with pending access actions", async () => {
    // That branch renders its own row shape, so the signal has to be in both.
    renderInOpenDropdown(createPendingVendorGrantNotification(), vi.fn());

    const row = await screen.findByRole("group");

    expect(row.firstElementChild?.className).toContain("bg-primary");
    expect(screen.getByText("unreadIndicator").className).toContain("sr-only");
    // That branch renders its own paragraph, so the weight has to be pinned
    // there too, or only these rows keep the reflow.
    const pendingMessageClassName = screen.getByText(
      new RegExp(VENDOR_GRANT_PENDING_MESSAGE_KEY),
    ).className;
    expect(pendingMessageClassName).not.toMatch(/font-/);
    // An empty class string would satisfy the line above and prove nothing.
    expect(pendingMessageClassName).toContain("text-sm");
  });
});
