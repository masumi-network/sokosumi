import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HeaderNotificationBell } from "@/app/components/header/header-notification-bell.client";
import { NotificationsPageContent } from "@/app/notifications/page-content";
import { NotificationProvider } from "@/contexts/notification-provider";
import type { NotificationEventData } from "@/lib/ably";
import type { NotificationItem } from "@/lib/clients/generated/core";

/**
 * The Notification Center, driven from the outside.
 *
 * The provider, the header panel and the notifications page are all real here,
 * and only what sits outside the Notification Center is mocked: the Core
 * browser client, realtime, the session, the toaster, and the viewport's own
 * reports about width and scrolling. A test asserts on what a reader would see
 * and on which Core calls the reader's moves produced.
 */

const getNotificationsMock = vi.fn();
const getNotificationsUnreadCountMock = vi.fn();
const patchNotificationReadMock = vi.fn();
const patchNotificationUnreadMock = vi.fn();
const patchNotificationsReadAllMock = vi.fn();
const isMobileMock = vi.fn();
const accountNoticeMock = vi.fn();
const toastErrorMock = vi.fn();
let deliverRealtime: (event: NotificationEventData) => void = () => {};

vi.mock("@/lib/clients/core.notifications.browser.client", () => ({
  notificationsBrowserClient: {
    getNotifications: (...args: unknown[]) => getNotificationsMock(...args),
    getNotificationsUnreadCount: (...args: unknown[]) =>
      getNotificationsUnreadCountMock(...args),
    patchNotificationRead: (...args: unknown[]) =>
      patchNotificationReadMock(...args),
    patchNotificationUnread: (...args: unknown[]) =>
      patchNotificationUnreadMock(...args),
    patchNotificationsReadAll: (...args: unknown[]) =>
      patchNotificationsReadAllMock(...args),
  },
}));

vi.mock("@/hooks/use-mobile", () => ({
  MOBILE_BREAKPOINT: 768,
  useIsMobile: () => isMobileMock(),
  useIsMobileMedia: () => isMobileMock(),
}));

vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  return {
    ...actual,
    toast: Object.assign(actual.toast, {
      error: (...args: unknown[]) => toastErrorMock(...args),
    }),
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values?.message ? `${key}: ${String(values.message)}` : key,
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: null }),
}));
vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: () => ({ handleSelectWorkspace: vi.fn() }),
}));
vi.mock("@/contexts/account-notice-provider", () => ({
  useAccountNotice: () => accountNoticeMock(),
}));
vi.mock("@/app/components/account-notice-row", () => ({
  AccountNoticeRow: () => <p>account notice</p>,
}));
vi.mock("@/app/components/notification-browser-permission-primer", () => ({
  NotificationBrowserPermissionPrimer: () => null,
}));
vi.mock("@/lib/utils/notification-message", () => ({
  useNotificationMessage: () => (key: string) => key,
}));
vi.mock("@/lib/utils/notification-time", () => ({
  useNotificationTimeFormatter: () => () => "today",
}));
vi.mock("@/lib/ably/use-notification-realtime", () => ({
  useNotificationRealtime: ({
    onNotification,
  }: {
    onNotification: (event: NotificationEventData) => void;
  }) => {
    deliverRealtime = onNotification;
  },
}));
vi.mock("@/lib/ably/push-self-heal.client", () => ({
  healPushSubscription: async () => false,
}));
vi.mock("ably/react", () => ({
  ChannelProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/lazy-ably-provider", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/app/components/notification-toast-listener", () => ({
  NotificationToastListener: () => null,
}));
vi.mock("@/app/components/notification-url-target-opener", () => ({
  NotificationUrlTargetOpener: () => null,
}));

const observers = new Set<StubIntersectionObserver>();

/** Lets a test say "this row came into view", which happy-dom cannot. */
class StubIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds = [0];
  private readonly callback: IntersectionObserverCallback;
  private readonly targets = new Set<Element>();

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(element: Element) {
    this.targets.add(element);
    observers.add(this);
  }

  disconnect() {
    this.targets.clear();
    observers.delete(this);
  }

  unobserve(element: Element) {
    this.targets.delete(element);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  fire(element: Element) {
    if (!this.targets.has(element)) return;
    const entry = { isIntersecting: true, target: element };
    this.callback([entry as IntersectionObserverEntry], this);
  }
}

function intersect(element: Element) {
  for (const observer of [...observers]) observer.fire(element);
}

function row(
  id: string,
  overrides: Partial<NotificationItem> = {},
): NotificationItem {
  return {
    id,
    userId: "user-1",
    kind: "JOB",
    referenceId: "job-1",
    eventId: "event-1",
    messageKey: id,
    messageParams: {},
    metadata: null,
    isRead: true,
    readAt: new Date("2026-06-18T09:30:00.000Z"),
    createdAt: new Date("2026-06-18T09:00:00.000Z"),
    ...overrides,
  };
}

function page(rows: NotificationItem[], nextCursor: string | null = null) {
  return { data: rows, meta: { pagination: { nextCursor } } };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderPage() {
  render(
    <NotificationProvider userId="user-1">
      <NotificationsPageContent />
    </NotificationProvider>,
  );
  await settle();
}

async function renderPanel() {
  render(
    <NotificationProvider userId="user-1">
      <HeaderNotificationBell />
    </NotificationProvider>,
  );
  await settle();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: /^notifications$|unreadBadge/ }));
  await settle();
}

const FRAMES = [
  ["page", renderPage],
  ["panel", renderPanel],
] as const;

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
  observers.clear();
  for (const mock of [
    getNotificationsMock,
    getNotificationsUnreadCountMock,
    patchNotificationReadMock,
    patchNotificationUnreadMock,
    patchNotificationsReadAllMock,
    isMobileMock,
    accountNoticeMock,
    toastErrorMock,
  ]) {
    mock.mockReset();
  }
  isMobileMock.mockReturnValue(false);
  accountNoticeMock.mockReturnValue({ notice: null });
  getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 0 } });
  getNotificationsMock.mockResolvedValue(page([]));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Notification Center, both frames", () => {
  it.each(FRAMES)(
    "lists the rows Core returned, newest first, in the %s",
    async (_, mount) => {
      getNotificationsMock.mockResolvedValue(
        page([
          row("newest", { createdAt: new Date("2026-06-18T09:00:00.000Z") }),
          row("older", { createdAt: new Date("2026-06-17T09:00:00.000Z") }),
        ]),
      );

      await mount();

      expect(getNotificationsMock).toHaveBeenCalledWith({ limit: 20 });
      const messages = screen
        .getAllByText(/^newest$|^older$/)
        .map((element) => element.textContent);
      expect(messages).toEqual(["newest", "older"]);
    },
  );

  it.each(FRAMES)(
    "offers no way to remove a row in the %s",
    async (_, mount) => {
      getNotificationsMock.mockResolvedValue(page([row("only")]));

      await mount();

      expect(
        screen.queryByRole("button", { name: /delete|clear/i }),
      ).toBeNull();
      expect(screen.queryByRole("alertdialog")).toBeNull();
    },
  );

  it.each(FRAMES)(
    "loads the older page when the end comes into view in the %s",
    async (_, mount) => {
      getNotificationsMock.mockResolvedValue(
        page(
          [
            row("newest", { createdAt: new Date("2026-06-18T09:00:00.000Z") }),
            row("oldest-loaded", {
              createdAt: new Date("2026-06-17T09:00:00.000Z"),
            }),
          ],
          "oldest-loaded",
        ),
      );

      await mount();

      getNotificationsMock.mockResolvedValue(
        page([
          row("older", { createdAt: new Date("2026-06-16T09:00:00.000Z") }),
        ]),
      );
      await act(async () => {
        intersect(screen.getByTestId("notification-older-boundary"));
        await Promise.resolve();
      });

      expect(getNotificationsMock).toHaveBeenLastCalledWith({
        limit: 20,
        cursor: "oldest-loaded",
      });
      expect(screen.getByText("older")).toBeTruthy();
      // Nothing older left, so the end of the list reads as the end.
      expect(screen.queryByTestId("notification-older-boundary")).toBeNull();
    },
  );

  it.each(FRAMES)(
    "marks a row read and puts it back in the %s",
    async (_, mount) => {
      const unread = row("mine", { isRead: false, readAt: null });
      getNotificationsMock.mockResolvedValue(page([unread]));
      getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 1 } });
      patchNotificationReadMock.mockResolvedValue({
        data: { ...unread, isRead: true, readAt: new Date() },
      });
      patchNotificationUnreadMock.mockResolvedValue({ data: unread });

      await mount();
      const user = userEvent.setup();

      // One control per row, and only the one that changes it.
      expect(
        screen.queryByRole("button", { name: "markUnread: mine" }),
      ).toBeNull();
      await user.click(screen.getByRole("button", { name: "markRead: mine" }));
      await settle();
      expect(patchNotificationReadMock).toHaveBeenCalledWith({ id: "mine" });

      await user.click(
        screen.getByRole("button", { name: "markUnread: mine" }),
      );
      await settle();
      expect(patchNotificationUnreadMock).toHaveBeenCalledWith({ id: "mine" });
      expect(
        screen.getByRole("button", { name: "markRead: mine" }),
      ).toBeTruthy();
    },
  );

  it.each(FRAMES)(
    "settles the badge with mark all as read in the %s",
    async (_, mount) => {
      getNotificationsMock.mockResolvedValue(
        page([row("mine", { isRead: false, readAt: null })]),
      );
      getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 1 } });
      patchNotificationsReadAllMock.mockResolvedValue({ data: { count: 1 } });

      await mount();
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "markAllRead" }));
      await settle();

      expect(patchNotificationsReadAllMock).toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "markAllRead" })).toBeNull();
      expect(
        screen.getByRole("button", { name: "markUnread: mine" }),
      ).toBeTruthy();
    },
  );

  it("keeps the page's action row in place when nothing is left unread", async () => {
    getNotificationsMock.mockResolvedValue(
      page([row("mine", { isRead: false, readAt: null })]),
    );
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 1 } });
    patchNotificationReadMock.mockResolvedValue({
      data: row("mine", { isRead: true }),
    });

    await renderPage();
    const actions = screen.getByTestId("notifications-page-actions");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "markRead: mine" }));
    await settle();

    // The button goes, its row stays: a row that left with it would pull the
    // whole list up under the reader's pointer.
    expect(screen.queryByRole("button", { name: "markAllRead" })).toBeNull();
    expect(screen.getByTestId("notifications-page-actions")).toBe(actions);
  });

  it("puts a row back and says so when marking it read fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    getNotificationsMock.mockResolvedValue(
      page([row("mine", { isRead: false, readAt: null })]),
    );
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 1 } });

    await renderPage();
    getNotificationsMock.mockRejectedValue(new Error("offline"));
    patchNotificationReadMock.mockRejectedValue(new Error("offline"));
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "markRead: mine" }));
    await settle();

    expect(toastErrorMock).toHaveBeenCalledWith("markReadError");
    expect(screen.getByRole("button", { name: "markRead: mine" })).toBeTruthy();
    consoleError.mockRestore();
  });

  it("adds an arriving row to the open panel without dropping the pages loaded", async () => {
    getNotificationsMock.mockResolvedValue(
      page(
        [row("loaded", { createdAt: new Date("2026-06-18T09:00:00.000Z") })],
        "loaded",
      ),
    );
    await renderPanel();
    getNotificationsMock.mockResolvedValue(
      page([row("paged", { createdAt: new Date("2026-06-10T09:00:00.000Z") })]),
    );
    await act(async () => {
      intersect(screen.getByTestId("notification-older-boundary"));
      await Promise.resolve();
    });

    await act(async () => {
      deliverRealtime({
        ...row("arrived", {
          isRead: false,
          readAt: null,
          createdAt: new Date("2026-06-18T10:00:00.000Z"),
        }),
        readAt: null,
        createdAt: "2026-06-18T10:00:00.000Z",
        inApp: true,
        osBanner: false,
        created: true,
      } as NotificationEventData);
    });

    const messages = screen
      .getAllByText(/^arrived$|^loaded$|^paged$/)
      .map((element) => element.textContent);
    expect(messages).toEqual(["arrived", "loaded", "paged"]);
  });

  it("keeps a failed page on the row and loads it when the reader retries", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    getNotificationsMock.mockResolvedValue(page([row("newest")], "newest"));

    await renderPage();

    getNotificationsMock.mockRejectedValue(new Error("offline"));
    await act(async () => {
      intersect(screen.getByTestId("notification-older-boundary"));
      await Promise.resolve();
    });

    const boundary = screen.getByTestId("notification-older-boundary");
    expect(within(boundary).getByRole("alert").textContent).toBe("fetchError");
    const callsAfterFailure = getNotificationsMock.mock.calls.length;

    // The row does not ask again on its own: a list that kept asking would
    // hammer a server that just said no.
    await act(async () => {
      intersect(boundary);
      await Promise.resolve();
    });
    expect(getNotificationsMock.mock.calls.length).toBe(callsAfterFailure);

    getNotificationsMock.mockResolvedValue(page([row("older")]));
    await userEvent.setup().click(within(boundary).getByRole("button"));
    await settle();

    expect(screen.getByText("older")).toBeTruthy();
    consoleError.mockRestore();
  });

  it("says the Notification Center is empty when it is", async () => {
    await renderPage();

    expect(screen.getByText("emptyState")).toBeTruthy();
  });

  it("leaves the empty state out under an account notice", async () => {
    accountNoticeMock.mockReturnValue({ notice: { tone: "warning" } });

    await renderPage();

    expect(screen.getByText("account notice")).toBeTruthy();
    expect(screen.queryByText("emptyState")).toBeNull();
  });

  it("offers a retry when the first page will not load", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    getNotificationsMock.mockRejectedValue(new Error("offline"));

    await renderPage();

    expect(screen.getByText("fetchError")).toBeTruthy();

    getNotificationsMock.mockResolvedValue(page([row("back")]));
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "retry" }));
    await settle();

    expect(screen.getByText("back")).toBeTruthy();
    consoleError.mockRestore();
  });

  it("opens the panel without putting focus in its first row", async () => {
    getNotificationsMock.mockResolvedValue(
      page([
        row("first", { createdAt: new Date("2026-06-18T09:00:00.000Z") }),
        row("second", { createdAt: new Date("2026-06-17T09:00:00.000Z") }),
      ]),
    );

    await renderPanel();

    // A row with focus inside shows its read control, so focusing the first
    // row on open would single it out before the reader has touched it.
    const panel = screen
      .getByRole("button", { name: "markUnread: first" })
      .closest("[data-slot='popover-content']");
    expect(document.activeElement).toBe(panel);

    // The rows stay one Tab away.
    await userEvent.setup().tab();
    expect(document.activeElement?.textContent).toContain("first");
  });

  it("opens the notifications page instead of a panel on a phone", async () => {
    isMobileMock.mockReturnValue(true);
    render(
      <NotificationProvider userId="user-1">
        <HeaderNotificationBell />
      </NotificationProvider>,
    );
    await settle();

    const bell = screen.getByRole("link", { name: "notifications" });
    expect(bell.getAttribute("href")).toBe("/notifications");
    expect(screen.queryByRole("button", { name: "notifications" })).toBeNull();
  });
});
