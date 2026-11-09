import type { NotificationItem } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { snoozeMock, viewMock, toastSuccessMock, toastErrorMock } = vi.hoisted(
  () => ({
    snoozeMock: vi.fn(),
    viewMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }),
);

vi.mock("@/contexts/notification-provider", () => ({
  useNotifications: () => ({ view: viewMock(), snooze: snoozeMock }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "Thu 09:00" }),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock },
}));

import { NotificationSnoozeControl } from "./notification-snooze-control";

function item(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: "notif-1",
    userId: "user-1",
    kind: "TASK",
    referenceId: "task-1",
    eventId: "event-1",
    messageKey: "Notifications.Task.completed",
    messageParams: {},
    metadata: null,
    isRead: false,
    readAt: null,
    createdAt: new Date("2025-11-12T10:00:00.000Z"),
    ...overrides,
  };
}

describe("NotificationSnoozeControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewMock.mockReturnValue("all");
    snoozeMock.mockResolvedValue(undefined);
  });

  it("snoozes the row until tomorrow at 9:00", async () => {
    const user = userEvent.setup();
    render(
      <NotificationSnoozeControl
        notification={item()}
        notificationMessage="Done"
      />,
    );

    await user.click(screen.getByRole("button", { name: "snooze" }));
    await user.click(
      await screen.findByRole("menuitem", { name: /snoozePreset.tomorrow/ }),
    );

    expect(snoozeMock).toHaveBeenCalledTimes(1);
    const [id, until] = snoozeMock.mock.calls[0] as [string, Date];
    expect(id).toBe("notif-1");
    expect(until.getHours()).toBe(9);
    expect(until.getTime()).toBeGreaterThan(Date.now());
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "snoozedToast",
        expect.objectContaining({
          action: expect.objectContaining({ label: "undo" }),
        }),
      );
    });
  });

  it("offers an hour, tomorrow and next week", async () => {
    const user = userEvent.setup();
    render(
      <NotificationSnoozeControl
        notification={item()}
        notificationMessage="Done"
      />,
    );

    await user.click(screen.getByRole("button", { name: "snooze" }));

    expect(await screen.findAllByRole("menuitem")).toHaveLength(3);
  });

  it("unsnoozes from the Snoozed view", async () => {
    viewMock.mockReturnValue("snoozed");
    const user = userEvent.setup();
    render(
      <NotificationSnoozeControl
        notification={item({ snoozedUntil: new Date("2025-11-13T08:00:00Z") })}
        notificationMessage="Done"
      />,
    );

    await user.click(screen.getByRole("button", { name: "unsnooze" }));

    expect(snoozeMock).toHaveBeenCalledWith("notif-1", null);
  });

  it("says so when the snooze fails", async () => {
    snoozeMock.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(
      <NotificationSnoozeControl
        notification={item()}
        notificationMessage="Done"
      />,
    );

    await user.click(screen.getByRole("button", { name: "snooze" }));
    await user.click(
      await screen.findByRole("menuitem", { name: /snoozePreset.hour/ }),
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("snoozeError");
    });
  });

  it("is not offered on chat rows, which their room counts", () => {
    const { container } = render(
      <NotificationSnoozeControl
        notification={item({ kind: "CHAT" })}
        notificationMessage="Hi"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
