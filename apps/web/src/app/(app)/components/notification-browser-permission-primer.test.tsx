import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/** What `isPushSupported` reads. Absent in happy-dom, so both are stubbed. */
function setPushSupported(supported: boolean): void {
  if (supported) {
    vi.stubGlobal("PushManager", function PushManager() {});
  } else {
    Reflect.deleteProperty(globalThis, "PushManager");
  }
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: supported ? {} : undefined,
  });
}

/** Translations are mocked to the key, so the link text is the key. */
const settingsLink = () =>
  screen.getByRole("link", { name: "browserPermissionOpenSettings" });

describe("NotificationBrowserPermissionPrimer", () => {
  beforeEach(() => {
    setPushSupported(true);
  });

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

  /**
   * The settings switch cannot help here: it would record account consent that
   * reaches the reader's other devices and leave this browser silent. The
   * permission still buys the banners this app renders while a tab is open, so
   * the card keeps asking for it rather than pointing at a page that says no.
   */
  it("asks for the permission itself when this browser cannot push", async () => {
    setPushSupported(false);
    setNotificationPermission("default");
    requestPermissionMock.mockResolvedValue("granted");
    render(<NotificationBrowserPermissionPrimer />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "browserPermissionEnable" }),
    );

    expect(requestPermissionMock).toHaveBeenCalled();
  });

  it("stays out of the way once notifications are allowed", () => {
    setNotificationPermission("granted");
    const { container } = render(<NotificationBrowserPermissionPrimer />);

    expect(container).toBeEmptyDOMElement();
  });
});
