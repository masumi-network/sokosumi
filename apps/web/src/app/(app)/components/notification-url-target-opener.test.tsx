import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NOTIFICATION_TARGET_PARAM } from "@/lib/utils/notification-service-worker";

const TARGET = {
  id: "notification-1",
  kind: "CHAT",
  referenceId: "room-1",
  messageKey: "Notifications.Chat.mentioned",
  createdAt: "2026-01-01T00:00:00.000Z",
  // Non-null on purpose: a target that drops metadata cannot route to the
  // room, or the message inside it, that the banner came from.
  metadata: { messageId: "message-1", workspaceId: "workspace-1" },
};

const handleNotificationNavigation = vi.fn();
const markRead = vi.fn(() => Promise.resolve());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: () => ({ handleSelectWorkspace: vi.fn() }),
}));
vi.mock("@/lib/auth/auth.client", () => ({
  authClient: { getSession: vi.fn().mockResolvedValue({ data: null }) },
}));
vi.mock("@/lib/utils/notification-navigation", () => ({
  handleNotificationNavigation: (...args: unknown[]) =>
    handleNotificationNavigation(...args),
}));

let isLoading = false;

vi.mock("@/contexts/notification-provider", () => ({
  useNotifications: () => ({ isLoading }),
}));

import { NotificationUrlTargetOpener } from "./notification-url-target-opener";

function setUrl(search: string) {
  window.history.replaceState({}, "", `/${search}`);
}

describe("NotificationUrlTargetOpener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isLoading = false;
  });

  afterEach(() => {
    setUrl("");
  });

  /**
   * A click no tab could take opens a window and leaves the target on its
   * URL. It has to reach the same routing a posted click reaches, or the
   * reader lands on whatever page opened and no further.
   */
  it("opens the notification the window was opened for", async () => {
    setUrl(
      `?${NOTIFICATION_TARGET_PARAM}=${encodeURIComponent(JSON.stringify(TARGET))}`,
    );

    render(<NotificationUrlTargetOpener markRead={markRead} />);

    await vi.waitFor(() => {
      expect(handleNotificationNavigation).toHaveBeenCalledWith(
        TARGET,
        null,
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
    // A banner whose click opened a window was unread when it was rendered.
    expect(markRead).toHaveBeenCalledWith("notification-1");
    // Spent, or a reload would open it a second time.
    expect(window.location.search).toBe("");
  });

  /**
   * Marking a row read before the feed holds it leaves the optimistic update
   * nothing to change, and the snapshot that lands after carries the row
   * still unread. Core publishes nothing for a mention read, so the reader
   * would open the notification and watch its badge stay.
   */
  it("waits for the feed before opening, and spends the URL at once", async () => {
    isLoading = true;
    setUrl(
      `?${NOTIFICATION_TARGET_PARAM}=${encodeURIComponent(JSON.stringify(TARGET))}`,
    );

    const { rerender } = render(
      <NotificationUrlTargetOpener markRead={markRead} />,
    );

    expect(markRead).not.toHaveBeenCalled();
    expect(handleNotificationNavigation).not.toHaveBeenCalled();
    // Spent on mount even while the open waits, or a reload would repeat it.
    expect(window.location.search).toBe("");

    isLoading = false;
    rerender(<NotificationUrlTargetOpener markRead={markRead} />);

    await vi.waitFor(() => {
      expect(markRead).toHaveBeenCalledWith("notification-1");
    });
    expect(handleNotificationNavigation).toHaveBeenCalledTimes(1);
  });

  /**
   * Strict Mode runs a mount effect twice. The first run takes the target off
   * the URL and spends it, so a second read finds nothing: a component that
   * kept the second answer would overwrite the first with null and never
   * open. Production does not double-invoke, so this only ever broke the
   * environment the feature is verified in by hand.
   */
  it("opens once when the mount effect runs twice", async () => {
    setUrl(
      `?${NOTIFICATION_TARGET_PARAM}=${encodeURIComponent(JSON.stringify(TARGET))}`,
    );

    render(
      <StrictMode>
        <NotificationUrlTargetOpener markRead={markRead} />
      </StrictMode>,
    );

    await vi.waitFor(() => {
      expect(handleNotificationNavigation).toHaveBeenCalledTimes(1);
    });
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it("opens nothing when the URL names no notification", () => {
    setUrl("?keep=1");

    render(<NotificationUrlTargetOpener markRead={markRead} />);

    expect(handleNotificationNavigation).not.toHaveBeenCalled();
    expect(markRead).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?keep=1");
  });

  it("opens nothing for a target it cannot route", () => {
    setUrl(`?${NOTIFICATION_TARGET_PARAM}=not-json`);

    render(<NotificationUrlTargetOpener markRead={markRead} />);

    expect(handleNotificationNavigation).not.toHaveBeenCalled();
    expect(markRead).not.toHaveBeenCalled();
  });
});
