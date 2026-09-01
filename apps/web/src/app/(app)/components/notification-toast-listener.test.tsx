import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationEventData } from "@/lib/ably/schema";
import { NotificationKind } from "@/lib/clients/generated/core";

const onNotificationRef = {
  current: null as ((notification: NotificationEventData) => void) | null,
};

/** Whether the mocked channel is attached, i.e. the page still receives. */
let isReceiving = true;

vi.mock("@/lib/ably/use-notification-realtime", () => ({
  useNotificationRealtime: ({
    onNotification,
  }: {
    onNotification: (notification: NotificationEventData) => void;
  }) => {
    onNotificationRef.current = onNotification;
    return { isReceivingNotifications: () => isReceiving };
  },
}));

const showNotification = vi.fn((_input: unknown) => Promise.resolve(true));
const TARGET = {
  id: "notification-1",
  kind: "CHAT",
  referenceId: "room-1",
  messageKey: "Notifications.Chat.mentioned",
  // Non-null on purpose: a banner that drops metadata cannot route a click to
  // the room it came from.
  metadata: { chatRoomId: "room-1" },
};
const getNotificationServiceWorker = vi.fn(() => Promise.resolve({}));
const clickHandlerRef = {
  current: null as ((target: typeof TARGET) => void) | null,
};

const answerShowsNotificationsQuery = vi.fn(
  (_showsNotifications: () => boolean) => stopAnswering,
);
const stopAnswering = vi.fn();

// Only the browser-facing calls are stubbed. The constants and
// `toNotificationTarget` stay real, so the assertions below check the target
// the app actually builds rather than one the test wrote for itself.
vi.mock("@/lib/utils/notification-service-worker", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/utils/notification-service-worker")
  >()),
  answerShowsNotificationsQuery: (showsNotifications: () => boolean) =>
    answerShowsNotificationsQuery(showsNotifications),
  getNotificationServiceWorker: () => getNotificationServiceWorker(),
  showNotification: (input: unknown) => showNotification(input),
  subscribeNotificationClicks: (onClick: (target: typeof TARGET) => void) => {
    clickHandlerRef.current = onClick;
    return () => {
      clickHandlerRef.current = null;
    };
  },
}));

vi.mock("@/lib/utils/browser-notification", () => ({
  getBrowserNotificationPermission: () => "granted",
  shouldShowBrowserNotification: ({
    isDocumentFocused,
    isRead,
  }: {
    isDocumentFocused: boolean;
    isRead: boolean;
  }) => !isRead && !isDocumentFocused,
}));

const handleNotificationNavigation = vi.fn();
const markRead = vi.fn(() => Promise.resolve());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { dismiss: vi.fn() }),
}));
vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: () => ({ handleSelectWorkspace: vi.fn() }),
}));
vi.mock("@/lib/auth/auth.client", () => ({
  authClient: { getSession: vi.fn().mockResolvedValue({ data: null }) },
}));
vi.mock("@/lib/utils/notification-message", () => ({
  useNotificationMessage: () => () => "message",
}));
vi.mock("@/lib/utils/notification-navigation", () => ({
  handleNotificationNavigation: (...args: unknown[]) =>
    handleNotificationNavigation(...args),
}));

import { NotificationToastListener } from "./notification-toast-listener";

const NOTIFICATION: NotificationEventData = {
  ...TARGET,
  kind: NotificationKind.CHAT,
  userId: "user-1",
  eventId: "event-1",
  messageParams: {},
  isRead: false,
  readAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  inApp: true,
  osBanner: true,
};

function emitOnUnfocusedTab() {
  render(<NotificationToastListener userId="user-1" markRead={markRead} />);
  onNotificationRef.current?.(NOTIFICATION);
}

describe("NotificationToastListener OS banner", () => {
  beforeEach(() => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
  });

  afterEach(() => {
    isReceiving = true;
    vi.restoreAllMocks();
    showNotification.mockClear();
    getNotificationServiceWorker.mockClear();
    answerShowsNotificationsQuery.mockClear();
    stopAnswering.mockClear();
    handleNotificationNavigation.mockClear();
    markRead.mockClear();
  });

  /**
   * ADR-0023 makes the worker's registration the single renderer, so the page
   * asks it for the banner rather than constructing one of its own.
   */
  it("renders the banner through the service worker", async () => {
    emitOnUnfocusedTab();

    await vi.waitFor(() => {
      expect(showNotification).toHaveBeenCalledWith(
        expect.objectContaining({ body: "message", target: TARGET }),
      );
    });
  });

  /**
   * An open tab renders its own banner rather than waiting for the push, so the
   * reader's banner choice has to be read here too. Reading it only on the push
   * would leave the banner running for anyone with a tab open.
   */
  it("renders no banner when the reader silenced the category's banner", async () => {
    render(<NotificationToastListener userId="user-1" markRead={markRead} />);
    onNotificationRef.current?.({ ...NOTIFICATION, osBanner: false });

    await vi.waitFor(() => {
      expect(getNotificationServiceWorker).toHaveBeenCalled();
    });
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("installs the worker on mount so the first banner does not wait", () => {
    render(<NotificationToastListener userId="user-1" markRead={markRead} />);

    expect(getNotificationServiceWorker).toHaveBeenCalled();
  });

  /**
   * The worker skips its banner only for a page that answers, so a focused tab
   * without this listener keeps its banner instead of going silent.
   */
  it("answers the worker's query while it is mounted", () => {
    const { unmount } = render(
      <NotificationToastListener userId="user-1" markRead={markRead} />,
    );

    expect(answerShowsNotificationsQuery).toHaveBeenCalled();

    unmount();
    expect(stopAnswering).toHaveBeenCalled();
  });

  /**
   * The worker's listener is subscribed once on mount, but the callbacks it
   * runs are new on every render. A click has to reach the current ones.
   */
  it("routes a click through the newest render, not the mounted one", async () => {
    const { rerender } = render(
      <NotificationToastListener userId="user-1" markRead={markRead} />,
    );

    const laterMarkRead = vi.fn().mockResolvedValue(undefined);
    rerender(
      <NotificationToastListener userId="user-1" markRead={laterMarkRead} />,
    );

    clickHandlerRef.current?.(TARGET);

    await vi.waitFor(() => {
      expect(laterMarkRead).toHaveBeenCalledWith("notification-1");
    });
    expect(markRead).not.toHaveBeenCalled();
  });

  /**
   * The worker skips its banner when this page answers yes, so answering yes
   * while the channel is detached loses the notification both ways: no banner
   * from the worker, and no in-app update either.
   */
  it("tells the worker to keep its banner once the page stops receiving", () => {
    render(<NotificationToastListener userId="user-1" markRead={markRead} />);

    const showsNotifications = answerShowsNotificationsQuery.mock
      .calls[0]?.[0] as () => boolean;
    expect(showsNotifications()).toBe(true);

    isReceiving = false;
    expect(showsNotifications()).toBe(false);
  });

  it("marks read and routes when the worker reports a click", async () => {
    emitOnUnfocusedTab();
    await vi.waitFor(() => {
      expect(showNotification).toHaveBeenCalled();
    });

    clickHandlerRef.current?.(TARGET);

    await vi.waitFor(() => {
      expect(handleNotificationNavigation).toHaveBeenCalledWith(
        TARGET,
        null,
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
    expect(markRead).toHaveBeenCalledWith("notification-1");
  });

  /**
   * The tab that receives a click is not always the tab that rendered the
   * banner, so routing must not depend on this page having rendered it.
   */
  it("routes a click for a banner this page never rendered", async () => {
    render(<NotificationToastListener userId="user-1" markRead={markRead} />);

    clickHandlerRef.current?.(TARGET);

    await vi.waitFor(() => {
      expect(handleNotificationNavigation).toHaveBeenCalled();
    });
    expect(markRead).toHaveBeenCalledWith("notification-1");
    expect(showNotification).not.toHaveBeenCalled();
  });
});
