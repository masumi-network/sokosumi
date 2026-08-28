import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotificationBrowserPermissionPrimer } from "./notification-browser-permission-primer";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const requestPermissionMock = vi.fn();

function setNotificationPermission(permission: NotificationPermission): void {
  vi.stubGlobal(
    "Notification",
    Object.assign(function Notification() {}, {
      permission,
      requestPermission: requestPermissionMock,
    }),
  );
}

/** Translations are mocked to the key, so the link text is the key. */
const settingsLink = () =>
  screen.getByRole("link", { name: "browserPermissionOpenSettings" });

describe("NotificationBrowserPermissionPrimer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  /**
   * The card used to ask for the permission itself. That bought the reader
   * banners only while a tab stayed open: they clicked "enable notifications",
   * closed the app, and heard nothing. The account page runs the whole
   * gesture, so the card sends them there instead.
   */
  it("sends the reader to the push settings without asking the browser", async () => {
    setNotificationPermission("default");
    render(<NotificationBrowserPermissionPrimer />);

    expect(settingsLink()).toHaveAttribute(
      "href",
      "/account#notification-preferences",
    );

    await userEvent.click(settingsLink());

    expect(requestPermissionMock).not.toHaveBeenCalled();
  });

  it("closes the dropdown it sits in when the reader follows the link", async () => {
    setNotificationPermission("default");
    const handleNavigate = vi.fn();
    render(<NotificationBrowserPermissionPrimer onNavigate={handleNavigate} />);

    await userEvent.click(settingsLink());

    expect(handleNavigate).toHaveBeenCalled();
  });

  /**
   * The account page cannot lift a block either, so this state gets no link
   * to it. Only the browser's own settings can.
   */
  it("offers no link once the browser blocks notifications", () => {
    setNotificationPermission("denied");
    render(<NotificationBrowserPermissionPrimer />);

    expect(
      screen.getByText("browserPermissionDeniedDescription"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("stays out of the way once notifications are allowed", () => {
    setNotificationPermission("granted");
    const { container } = render(<NotificationBrowserPermissionPrimer />);

    expect(container).toBeEmptyDOMElement();
  });
});
