import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClearNotificationsDialog } from "@/components/notifications/clear-notifications-dialog";

const clearNotificationsMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock("@/contexts/notification-provider", () => ({
  useNotifications: () => ({
    clearNotifications: clearNotificationsMock,
  }),
}));

describe("ClearNotificationsDialog", () => {
  beforeEach(() => {
    clearNotificationsMock.mockReset();
    clearNotificationsMock.mockResolvedValue(undefined);
    vi.mocked(toast.error).mockReset();
  });

  it("clears the center when the reader confirms", async () => {
    const user = userEvent.setup();
    const onClearing = vi.fn();

    render(
      <ClearNotificationsDialog
        open
        onOpenChange={vi.fn()}
        onClearing={onClearing}
      />,
    );

    await user.click(screen.getByRole("button", { name: "clearAll" }));

    await waitFor(() => {
      expect(clearNotificationsMock).toHaveBeenCalledTimes(1);
    });
    expect(onClearing).toHaveBeenCalledTimes(1);
  });

  it("deletes nothing when the reader cancels", async () => {
    const user = userEvent.setup();
    const onClearing = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <ClearNotificationsDialog
        open
        onOpenChange={onOpenChange}
        onClearing={onClearing}
      />,
    );

    await user.click(screen.getByRole("button", { name: "cancel" }));

    expect(clearNotificationsMock).not.toHaveBeenCalled();
    expect(onClearing).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("tells the reader and asks for a reread when clearing fails", async () => {
    const user = userEvent.setup();
    const onClearFailed = vi.fn();
    clearNotificationsMock.mockRejectedValue(new Error("network down"));

    render(
      <ClearNotificationsDialog
        open
        onOpenChange={vi.fn()}
        onClearFailed={onClearFailed}
      />,
    );

    await user.click(screen.getByRole("button", { name: "clearAll" }));

    await waitFor(() => {
      expect(onClearFailed).toHaveBeenCalledTimes(1);
    });
    expect(toast.error).toHaveBeenCalledWith("clearAllError");
  });
});
