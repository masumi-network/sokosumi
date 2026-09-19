import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_PREFERENCES_HREF } from "../account/constants";
import { NotificationBrowserPermissionPrimer } from "./notification-browser-permission-primer";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: { user: { id: SESSION_USER_ID } } }),
}));

const { activatePushMock, recordPushRepairOutcomeMock } = vi.hoisted(() => ({
  activatePushMock: vi.fn(),
  recordPushRepairOutcomeMock: vi.fn(),
}));

/** What the app-open repair left this browser in, per test. */
let repairOutcome: "pending" | "quiet" | "healthy" = "pending";

vi.mock("@/lib/ably/push-repair-outcome.client", () => ({
  getPushRepairOutcome: () => repairOutcome,
  getServerPushRepairOutcome: () => "pending",
  subscribePushRepairOutcome: () => () => {},
  // The press chains onto what this returns, and its chain can settle after
  // the test that started it, once the mock has been cleared. The real module
  // always returns a promise, so the stand-in does too.
  recordPushRepairOutcome: (...args: unknown[]) =>
    recordPushRepairOutcomeMock(...args) ?? Promise.resolve(),
}));

vi.mock("@/lib/ably/push-activation.client", () => ({
  activatePush: (...args: unknown[]) => activatePushMock(...args),
}));

let preferences:
  | {
      data: {
        pushOptIn: boolean;
        notificationPreferences: { channel: string; enabled: boolean }[];
      };
    }
  | undefined;

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: preferences }),
}));

const SESSION_USER_ID = "user_alice";

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
    repairOutcome = "pending";
    preferences = {
      data: {
        pushOptIn: true,
        notificationPreferences: [{ channel: "OS_BANNER", enabled: true }],
      },
    };
    activatePushMock.mockResolvedValue(true);
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

  it("closes the panel it sits in when the reader follows the link", async () => {
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
    repairOutcome = "healthy";
    const { container } = render(<NotificationBrowserPermissionPrimer />);

    expect(container).toBeEmptyDOMElement();
  });

  /**
   * The state SOK-929 names. The reader set this browser up for push, it lost
   * its subscription, and the app-open repair could not bring one back. The
   * permission is granted, so there is nothing left to ask for: the card says
   * what happened and offers the one press that fixes it.
   */
  it.each(["opted out", "no push deliveries", "unknown"])(
    "hides the repair notice when preferences are %s",
    (state) => {
      setNotificationPermission("granted");
      repairOutcome = "quiet";
      preferences =
        state === "unknown"
          ? undefined
          : {
              data: {
                pushOptIn: state !== "opted out",
                notificationPreferences: [
                  {
                    channel: "OS_BANNER",
                    enabled: state !== "no push deliveries",
                  },
                ],
              },
            };
      const { container } = render(<NotificationBrowserPermissionPrimer />);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("tells the reader when this browser stopped receiving push", async () => {
    setNotificationPermission("granted");
    repairOutcome = "quiet";
    render(<NotificationBrowserPermissionPrimer />);

    expect(screen.getByText("pushQuietDescription")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "pushQuietRestore" }),
    );

    expect(activatePushMock).toHaveBeenCalledWith(SESSION_USER_ID);
    // Read again rather than assumed: a repair that failed leaves the card
    // where it was instead of reporting a success it did not get.
    expect(recordPushRepairOutcomeMock).toHaveBeenCalled();
  });

  /**
   * The press is not over until the outcome is written down. Releasing the
   * button first leaves it live over a card that still says push is off, so a
   * second press would start another activation against the first one's
   * answer. A recording that fails still releases it: a reader whose browser
   * could not be written down gets to try again.
   */
  it("holds the button until the outcome is recorded, and frees it on failure", async () => {
    setNotificationPermission("granted");
    repairOutcome = "quiet";
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    recordPushRepairOutcomeMock.mockRejectedValue(
      new Error("storage is blocked"),
    );
    render(<NotificationBrowserPermissionPrimer />);

    const restore = screen.getByRole("button", { name: "pushQuietRestore" });
    await userEvent.click(restore);

    expect(consoleError).toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "pushQuietRestore" }),
    ).toBeEnabled();
    consoleError.mockRestore();
  });

  /**
   * The press can destroy the registration it would be read back from: the
   * activation clears Ably's stored state halfway through its round. Reading
   * it again after a failed press would find none, call this browser healthy,
   * and take the card away as though the press had worked.
   */
  it("carries the registration past a press that fails", async () => {
    setNotificationPermission("granted");
    repairOutcome = "quiet";
    activatePushMock.mockRejectedValue(
      new Error("The browser created no push subscription"),
    );
    render(<NotificationBrowserPermissionPrimer />);

    await userEvent.click(
      screen.getByRole("button", { name: "pushQuietRestore" }),
    );

    expect(recordPushRepairOutcomeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hadRegistration: true,
        teardownVersion: expect.any(String),
      }),
    );
    expect(screen.getByText("pushQuietDescription")).toBeInTheDocument();
  });

  /**
   * The repair runs in the notification provider and answers after this card
   * has painted. Saying push stopped before it answers would show the notice
   * on every browser the repair is about to fix.
   */
  it("says nothing until the repair has answered", () => {
    setNotificationPermission("granted");
    repairOutcome = "pending";
    preferences = {
      data: {
        pushOptIn: true,
        notificationPreferences: [{ channel: "OS_BANNER", enabled: true }],
      },
    };
    const { container } = render(<NotificationBrowserPermissionPrimer />);

    expect(container).toBeEmptyDOMElement();
  });
});
