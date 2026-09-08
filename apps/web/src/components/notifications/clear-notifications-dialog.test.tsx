import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
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
    const onOpenChange = vi.fn();

    render(
      <ClearNotificationsDialog
        open
        onOpenChange={onOpenChange}
        onCloseAutoFocus={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "clearAll" }));

    await waitFor(() => {
      expect(clearNotificationsMock).toHaveBeenCalledTimes(1);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("deletes nothing when the reader cancels", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <ClearNotificationsDialog
        open
        onOpenChange={onOpenChange}
        onCloseAutoFocus={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "cancel" }));

    expect(clearNotificationsMock).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("tells the reader and closes the dialog when clearing fails", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    clearNotificationsMock.mockRejectedValue(new Error("network down"));

    render(
      <ClearNotificationsDialog
        open
        onOpenChange={onOpenChange}
        onCloseAutoFocus={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "clearAll" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("clearAllError");
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

function FocusHost({ removeOpener = false }: { removeOpener?: boolean }) {
  const [open, setOpen] = useState(false);
  const [hasNotifications, setHasNotifications] = useState(true);
  const openerRef = useRef<HTMLButtonElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={pageRef} tabIndex={-1} data-testid="notification-page">
      {hasNotifications ? (
        <button ref={openerRef} type="button" onClick={() => setOpen(true)}>
          Open clear dialog
        </button>
      ) : null}
      <ClearNotificationsDialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen && removeOpener) setHasNotifications(false);
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          (openerRef.current ?? pageRef.current)?.focus();
        }}
      />
    </div>
  );
}

describe("ClearNotificationsDialog focus", () => {
  it("restores focus to the opener after cancel", async () => {
    const user = userEvent.setup();
    render(<FocusHost />);
    const opener = screen.getByRole("button", { name: "Open clear dialog" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "cancel" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("focuses the page after a successful clear removes the opener", async () => {
    clearNotificationsMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<FocusHost removeOpener />);
    await user.click(screen.getByRole("button", { name: "Open clear dialog" }));
    await user.click(screen.getByRole("button", { name: "clearAll" }));
    await waitFor(() =>
      expect(screen.getByTestId("notification-page")).toHaveFocus(),
    );
    expect(
      screen.queryByRole("button", { name: "Open clear dialog" }),
    ).toBeNull();
  });
});
