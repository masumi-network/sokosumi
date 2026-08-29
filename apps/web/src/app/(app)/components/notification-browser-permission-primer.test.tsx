import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_PREFERENCES_HREF } from "../account/constants";
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

/** Both are absent in happy-dom, and the card reads them separately. */
function setPushSupported(supported: boolean): void {
  if (supported) {
    vi.stubGlobal("PushManager", function PushManager() {});
  } else {
    Reflect.deleteProperty(globalThis, "PushManager");
  }
}

function setServiceWorkerSupported(supported: boolean): void {
  if (supported) {
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: {},
    });
    return;
  }

  // Deleted, not undefined: the check is `"serviceWorker" in navigator`.
  Reflect.deleteProperty(window.navigator, "serviceWorker");
}

/** Translations are mocked to the key, so the link text is the key. */
const settingsLink = () =>
  screen.getByRole("link", { name: "browserPermissionOpenSettings" });

describe("NotificationBrowserPermissionPrimer", () => {
  beforeEach(() => {
    setPushSupported(true);
    setServiceWorkerSupported(true);
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
  it("sends a push-capable browser to the settings without asking it", async () => {
    setNotificationPermission("default");
    render(<NotificationBrowserPermissionPrimer />);

    expect(settingsLink()).toHaveAttribute(
      "href",
      NOTIFICATION_PREFERENCES_HREF,
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
    setServiceWorkerSupported(true);
    setNotificationPermission("default");
    requestPermissionMock.mockResolvedValue("granted");
    render(<NotificationBrowserPermissionPrimer />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "browserPermissionEnable" }),
    );

    expect(requestPermissionMock).toHaveBeenCalled();
  });

  /**
   * The worker's registration is the only thing that renders a banner
   * (ADR-0023). With no worker, the permission would show nothing, so the card
   * asks for neither it nor a trip to a settings page that cannot help.
   */
  it("offers nothing when no worker can render a banner", () => {
    setPushSupported(false);
    setServiceWorkerSupported(false);
    setNotificationPermission("default");
    const { container } = render(<NotificationBrowserPermissionPrimer />);

    expect(container).toBeEmptyDOMElement();
  });

  it("stays out of the way once notifications are allowed", () => {
    setNotificationPermission("granted");
    const { container } = render(<NotificationBrowserPermissionPrimer />);

    expect(container).toBeEmptyDOMElement();
  });
});
