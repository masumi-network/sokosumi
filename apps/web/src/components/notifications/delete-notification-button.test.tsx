import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DeleteNotificationButton } from "@/components/notifications/delete-notification-button";

const deleteNotificationMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const parts = values ? Object.values(values).map(String) : [];

    return parts.length > 0 ? `${key} ${parts.join(" ")}` : key;
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock("@/contexts/notification-provider", () => ({
  useNotifications: () => ({
    deleteNotification: deleteNotificationMock,
  }),
}));

function renderButton() {
  return render(
    <DeleteNotificationButton
      notificationId="notification-1"
      notificationMessage="Research Agent completed Market Analysis"
    />,
  );
}

describe("DeleteNotificationButton", () => {
  beforeEach(() => {
    deleteNotificationMock.mockReset();
    deleteNotificationMock.mockResolvedValue(undefined);
    vi.mocked(toast.error).mockReset();
  });

  it("deletes the notification named by the control", async () => {
    const user = userEvent.setup();

    renderButton();

    await user.click(
      screen.getByRole("button", {
        name: "delete Research Agent completed Market Analysis",
      }),
    );

    await waitFor(() => {
      expect(deleteNotificationMock).toHaveBeenCalledWith("notification-1");
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("tells the reader when the delete fails", async () => {
    const user = userEvent.setup();
    deleteNotificationMock.mockRejectedValue(new Error("network down"));

    renderButton();

    await user.click(screen.getByRole("button", { name: /^delete/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("deleteError");
    });
  });
});
