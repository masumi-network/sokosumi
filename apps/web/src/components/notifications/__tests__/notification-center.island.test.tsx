import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HeaderNotificationBell } from "@/app/components/header/header-notification-bell.client";
import { NotificationsPageContent } from "@/app/notifications/page-content";
import { NotificationProvider } from "@/contexts/notification-provider";
import { NOTIFICATION_VIEW_STORAGE_KEY } from "@/contexts/notification-view-storage";
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
const getNotificationsCountsMock = vi.fn();
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
    getNotificationsCounts: (...args: unknown[]) =>
      getNotificationsCountsMock(...args),
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
  // The key, unless the row carries a label: rows that share a real key
  // (every task that asked for input) still need telling apart on screen.
  useNotificationMessage:
    () => (key: string, params?: Record<string, unknown>) =>
      typeof params?.label === "string" ? params.label : key,
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
  window.localStorage.clear();
  for (const mock of [
    getNotificationsMock,
    getNotificationsCountsMock,
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
  getNotificationsCountsMock.mockResolvedValue({
    data: { unread: 0, needsAction: 0 },
  });
  getNotificationsMock.mockResolvedValue(page([]));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
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
      getNotificationsCountsMock.mockResolvedValue({
        data: { unread: 1, needsAction: 0 },
      });
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
      getNotificationsCountsMock.mockResolvedValue({
        data: { unread: 1, needsAction: 0 },
      });
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
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 1, needsAction: 0 },
    });
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
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 1, needsAction: 0 },
    });

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

  it("keeps loading older rows after a refresh starts the list over mid-page", async () => {
    const newest = row("newest", {
      createdAt: new Date("2026-06-18T09:00:00.000Z"),
    });
    const oldestLoaded = row("oldest-loaded", {
      createdAt: new Date("2026-06-17T09:00:00.000Z"),
    });
    getNotificationsMock.mockResolvedValue(
      page([newest, oldestLoaded], "oldest-loaded"),
    );
    await renderPage();

    const stale = Promise.withResolvers<unknown>();
    getNotificationsMock.mockReturnValueOnce(stale.promise);
    await act(async () => {
      intersect(screen.getByTestId("notification-older-boundary"));
      await Promise.resolve();
    });

    // More than a page of rows arrived while nothing was listening, so the
    // refresh a state-only event asks for starts the list over.
    getNotificationsMock.mockResolvedValue(
      page(
        [
          row("arrived", { createdAt: new Date("2026-06-19T10:00:00.000Z") }),
          row("arrived-oldest", {
            createdAt: new Date("2026-06-19T09:00:00.000Z"),
          }),
        ],
        "arrived-oldest",
      ),
    );
    await act(async () => {
      deliverRealtime({
        ...newest,
        isRead: false,
        readAt: null,
        createdAt: newest.createdAt.toISOString(),
        inApp: true,
        osBanner: false,
        created: false,
      } as NotificationEventData);
      await Promise.resolve();
    });
    await settle();
    // The boundary is still on screen while the old page is in the air.
    await act(async () => {
      intersect(screen.getByTestId("notification-older-boundary"));
      await Promise.resolve();
    });

    await act(async () => {
      stale.resolve(page([row("stale-older")]));
      await Promise.resolve();
    });
    await settle();
    getNotificationsMock.mockResolvedValue(page([]));
    await act(async () => {
      intersect(screen.getByTestId("notification-older-boundary"));
      await Promise.resolve();
    });

    expect(screen.queryByText("stale-older")).toBeNull();
    expect(getNotificationsMock).toHaveBeenLastCalledWith({
      limit: 20,
      cursor: "arrived-oldest",
    });
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

    // The header's own controls come first in tab order; the rows stay right
    // behind them.
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement?.textContent).toContain("filterAll");
    await user.tab();
    expect(document.activeElement?.textContent).toContain("first");
  });

  it("does not leave focus on a row's read control after a click", async () => {
    const unread = row("mine", { isRead: false, readAt: null });
    getNotificationsMock.mockResolvedValue(page([unread]));
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 1, needsAction: 0 },
    });
    patchNotificationReadMock.mockResolvedValue({
      data: { ...unread, isRead: true, readAt: new Date() },
    });

    await renderPanel();
    const control = screen.getByRole("button", { name: "markRead: mine" });
    await userEvent.setup().click(control);
    await settle();

    // A row shows its control while focus is inside it, so a control that
    // kept focus after a click would stay on screen after the pointer left.
    expect(patchNotificationReadMock).toHaveBeenCalledWith({ id: "mine" });
    expect(
      control.closest("[class*='group/row']")?.contains(document.activeElement),
    ).toBe(false);
  });

  it("keeps a row's read control reachable and focused from the keyboard", async () => {
    const unread = row("mine", { isRead: false, readAt: null });
    getNotificationsMock.mockResolvedValue(page([unread]));
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 1, needsAction: 0 },
    });
    patchNotificationReadMock.mockResolvedValue({
      data: { ...unread, isRead: true, readAt: new Date() },
    });

    await renderPanel();
    const user = userEvent.setup();
    const control = screen.getByRole("button", { name: "markRead: mine" });
    for (let step = 0; step < 5 && document.activeElement !== control; step++) {
      await user.tab();
    }
    expect(document.activeElement).toBe(control);

    await user.keyboard("{Enter}");
    await settle();

    expect(patchNotificationReadMock).toHaveBeenCalledWith({ id: "mine" });
    expect(document.activeElement).toBe(control);
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

describe("Notification Center view filter", () => {
  it("keeps the choice the panel made when the page shows the same list", async () => {
    const waiting = row("waiting", { isRead: false, readAt: null });
    const handled = row("handled", { isRead: true });
    getNotificationsMock.mockResolvedValue(page([waiting, handled]));
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 1, needsAction: 0 },
    });

    render(
      <NotificationProvider userId="user-1">
        <HeaderNotificationBell />
        <NotificationsPageContent />
      </NotificationProvider>,
    );
    await settle();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /^notifications$|unreadBadge/ }),
    );
    await settle();

    const panel = document.querySelector("[data-slot='popover-content']");
    expect(panel).not.toBeNull();
    const callsBefore = getNotificationsMock.mock.calls.length;

    getNotificationsMock.mockResolvedValue(page([waiting]));
    await user.click(
      within(panel as HTMLElement).getByRole("tab", { name: /^filterUnread/ }),
    );
    await settle();

    // One shared list: the switch refetches once, and both frames narrow.
    expect(getNotificationsMock.mock.calls.length).toBe(callsBefore + 1);
    expect(getNotificationsMock).toHaveBeenLastCalledWith({
      limit: 20,
      isRead: "false",
    });
    expect(screen.getAllByText("waiting")).toHaveLength(2);
    expect(screen.queryByText("handled")).toBeNull();
    for (const option of screen.getAllByRole("tab", {
      name: /^filterUnread/,
    })) {
      expect(option.getAttribute("aria-selected")).toBe("true");
    }
  });

  it.each(FRAMES)(
    "switches between all and unread in the %s",
    async (_, mount) => {
      const waiting = row("waiting", {
        isRead: false,
        readAt: null,
        createdAt: new Date("2026-06-18T09:00:00.000Z"),
      });
      const handled = row("handled", {
        isRead: true,
        createdAt: new Date("2026-06-17T09:00:00.000Z"),
      });
      getNotificationsMock.mockResolvedValue(page([waiting, handled]));
      getNotificationsCountsMock.mockResolvedValue({
        data: { unread: 1, needsAction: 0 },
      });

      await mount();
      const user = userEvent.setup();

      // The default view is all notifications.
      expect(
        screen
          .getByRole("tab", { name: "filterAll" })
          .getAttribute("aria-selected"),
      ).toBe("true");
      expect(screen.getByText("waiting")).toBeTruthy();
      expect(screen.getByText("handled")).toBeTruthy();

      getNotificationsMock.mockResolvedValue(page([waiting]));
      await user.click(screen.getByRole("tab", { name: /^filterUnread/ }));
      await settle();

      expect(getNotificationsMock).toHaveBeenLastCalledWith({
        limit: 20,
        isRead: "false",
      });
      expect(screen.getByText("waiting")).toBeTruthy();
      expect(screen.queryByText("handled")).toBeNull();

      getNotificationsMock.mockResolvedValue(page([waiting, handled]));
      await user.click(screen.getByRole("tab", { name: "filterAll" }));
      await settle();

      expect(getNotificationsMock).toHaveBeenLastCalledWith({ limit: 20 });
      expect(screen.getByText("waiting")).toBeTruthy();
      expect(screen.getByText("handled")).toBeTruthy();
    },
  );

  it.each(FRAMES)(
    "loads older unread rows with the unread query in the %s",
    async (_, mount) => {
      const first = row("first", {
        isRead: false,
        readAt: null,
        createdAt: new Date("2026-06-18T09:00:00.000Z"),
      });
      getNotificationsMock.mockResolvedValue(page([first], "first"));
      getNotificationsCountsMock.mockResolvedValue({
        data: { unread: 2, needsAction: 0 },
      });

      await mount();
      const user = userEvent.setup();

      getNotificationsMock.mockResolvedValue(page([first], "first"));
      await user.click(screen.getByRole("tab", { name: /^filterUnread/ }));
      await settle();

      getNotificationsMock.mockResolvedValue(
        page([
          row("older", {
            isRead: false,
            readAt: null,
            createdAt: new Date("2026-06-16T09:00:00.000Z"),
          }),
        ]),
      );
      await act(async () => {
        intersect(screen.getByTestId("notification-older-boundary"));
        await Promise.resolve();
      });

      expect(getNotificationsMock).toHaveBeenLastCalledWith({
        limit: 20,
        cursor: "first",
        isRead: "false",
      });
      expect(screen.getByText("older")).toBeTruthy();
    },
  );

  it.each(FRAMES)(
    "keeps a read row under the pointer and drops it once the pointer leaves in the %s",
    async (_, mount) => {
      const unread = row("mine", { isRead: false, readAt: null });
      getNotificationsMock.mockResolvedValue(page([unread]));
      getNotificationsCountsMock.mockResolvedValue({
        data: { unread: 1, needsAction: 0 },
      });
      patchNotificationReadMock.mockResolvedValue({
        data: { ...unread, isRead: true, readAt: new Date() },
      });

      await mount();
      const user = userEvent.setup();

      getNotificationsMock.mockResolvedValue(page([unread]));
      await user.click(screen.getByRole("tab", { name: /^filterUnread/ }));
      await settle();

      // The click leaves the pointer on the row, so the row stays, with its
      // way back on the same spot and nothing sliding under the cursor.
      await user.click(screen.getByRole("button", { name: "markRead: mine" }));
      await settle();
      expect(screen.getByText("mine")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "markUnread: mine" }),
      ).toBeTruthy();

      // Moving off the row is what lets it go.
      await user.unhover(screen.getByText("mine"));
      await waitFor(() => {
        expect(screen.queryByText("mine")).toBeNull();
      });
      expect(screen.getByText("emptyUnreadState")).toBeTruthy();
      // The row was already counted as read; hiding it must not restore the badge.
      expect(screen.queryByRole("button", { name: "markAllRead" })).toBeNull();
    },
  );

  it.each(FRAMES)(
    "keeps paging in Unread after loaded rows leave while more remain in the %s",
    async (_, mount) => {
      const first = row("first", { isRead: false, readAt: null });
      getNotificationsMock.mockResolvedValue(page([first], "first"));
      getNotificationsCountsMock.mockResolvedValue({
        data: { unread: 2, needsAction: 0 },
      });
      patchNotificationReadMock.mockResolvedValue({
        data: { ...first, isRead: true, readAt: new Date() },
      });

      await mount();
      const user = userEvent.setup();

      getNotificationsMock.mockResolvedValue(page([first], "first"));
      await user.click(screen.getByRole("tab", { name: /^filterUnread/ }));
      await settle();

      await user.click(screen.getByRole("button", { name: "markRead: first" }));
      await settle();
      await user.unhover(screen.getByText("first"));
      await waitFor(() => {
        expect(screen.queryByText("first")).toBeNull();
      });

      expect(screen.queryByText("emptyUnreadState")).toBeNull();
      expect(screen.getByTestId("notification-older-boundary")).toBeTruthy();

      getNotificationsMock.mockResolvedValue(
        page([
          row("older", {
            isRead: false,
            readAt: null,
            createdAt: new Date("2026-06-16T09:00:00.000Z"),
          }),
        ]),
      );
      await act(async () => {
        intersect(screen.getByTestId("notification-older-boundary"));
        await Promise.resolve();
      });

      expect(getNotificationsMock).toHaveBeenLastCalledWith({
        limit: 20,
        cursor: "first",
        isRead: "false",
      });
      expect(screen.getByText("older")).toBeTruthy();
    },
  );

  it.each(FRAMES)(
    "keeps a row the reader puts back before leaving it in the %s",
    async (_, mount) => {
      const unread = row("mine", { isRead: false, readAt: null });
      getNotificationsMock.mockResolvedValue(page([unread]));
      getNotificationsCountsMock.mockResolvedValue({
        data: { unread: 1, needsAction: 0 },
      });
      patchNotificationReadMock.mockResolvedValue({
        data: { ...unread, isRead: true, readAt: new Date() },
      });
      patchNotificationUnreadMock.mockResolvedValue({ data: unread });

      await mount();
      const user = userEvent.setup();

      getNotificationsMock.mockResolvedValue(page([unread]));
      await user.click(screen.getByRole("tab", { name: /^filterUnread/ }));
      await settle();

      await user.click(screen.getByRole("button", { name: "markRead: mine" }));
      await settle();
      await user.click(
        screen.getByRole("button", { name: "markUnread: mine" }),
      );
      await settle();

      await user.unhover(screen.getByText("mine"));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      expect(screen.getByText("mine")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "markRead: mine" }),
      ).toBeTruthy();
    },
  );

  it("folds a read row right after a tap, with no pointer left to hold it", async () => {
    const unread = row("mine", { isRead: false, readAt: null });
    getNotificationsMock.mockResolvedValue(page([unread]));
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 1, needsAction: 0 },
    });
    patchNotificationReadMock.mockResolvedValue({
      data: { ...unread, isRead: true, readAt: new Date() },
    });

    await renderPage();
    const user = userEvent.setup();

    getNotificationsMock.mockResolvedValue(page([unread]));
    await user.click(screen.getByRole("tab", { name: /^filterUnread/ }));
    await settle();

    await user.pointer({
      keys: "[TouchA]",
      target: screen.getByRole("button", { name: "markRead: mine" }),
    });
    await waitFor(() => {
      expect(screen.queryByText("mine")).toBeNull();
    });
  });

  it("gives an empty Unread page no action row to hold space for", async () => {
    getNotificationsMock.mockResolvedValue(page([]));

    await renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /^filterUnread/ }));
    await settle();

    expect(screen.getByText("emptyUnreadState")).toBeTruthy();
    expect(screen.queryByTestId("notifications-page-actions")).toBeNull();
  });

  it("drops a read row once a keyboard reader tabs off it", async () => {
    const unread = row("mine", { isRead: false, readAt: null });
    getNotificationsMock.mockResolvedValue(page([unread]));
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 1, needsAction: 0 },
    });
    patchNotificationReadMock.mockResolvedValue({
      data: { ...unread, isRead: true, readAt: new Date() },
    });

    await renderPage();
    const user = userEvent.setup();

    getNotificationsMock.mockResolvedValue(page([unread]));
    await user.click(screen.getByRole("tab", { name: /^filterUnread/ }));
    await settle();
    await user.unhover(screen.getByRole("tab", { name: /^filterUnread/ }));

    const toggle = screen.getByRole("button", { name: "markRead: mine" });
    toggle.focus();
    await user.keyboard("{Enter}");
    await settle();
    // Focus is still on the row's control, so the row waits.
    expect(screen.getByText("mine")).toBeTruthy();

    await user.tab();
    await waitFor(() => {
      expect(screen.queryByText("mine")).toBeNull();
    });
  });

  it.each(FRAMES)(
    "marks all read in the Unread view and empties the list at once in the %s",
    async (_, mount) => {
      const first = row("first", { isRead: false, readAt: null });
      const second = row("second", { isRead: false, readAt: null });
      getNotificationsMock.mockResolvedValue(page([first, second]));
      getNotificationsCountsMock.mockResolvedValue({
        data: { unread: 2, needsAction: 0 },
      });
      patchNotificationsReadAllMock.mockResolvedValue({ data: { count: 2 } });

      await mount();
      const user = userEvent.setup();

      getNotificationsMock.mockResolvedValue(page([first, second]));
      await user.click(screen.getByRole("tab", { name: /^filterUnread/ }));
      await settle();

      // The pointer is on the header button, not on a row, so every row
      // leaves and the narrowed list says so with its own message.
      await user.click(screen.getByRole("button", { name: "markAllRead" }));
      await waitFor(() => {
        expect(screen.queryByText("first")).toBeNull();
        expect(screen.queryByText("second")).toBeNull();
      });
      expect(screen.getByText("emptyUnreadState")).toBeTruthy();
      expect(screen.queryByText("emptyState")).toBeNull();
    },
  );

  it.each(FRAMES)(
    "does not load the next unread page after mark all read in the %s",
    async (_, mount) => {
      const first = row("first", { isRead: false, readAt: null });
      const second = row("second", { isRead: false, readAt: null });
      getNotificationsMock.mockResolvedValue(page([first, second], "second"));
      getNotificationsCountsMock.mockResolvedValue({
        data: { unread: 4, needsAction: 0 },
      });
      patchNotificationsReadAllMock.mockImplementation(
        () => new Promise(() => {}),
      );

      await mount();
      const user = userEvent.setup();

      getNotificationsMock.mockResolvedValue(page([first, second], "second"));
      await user.click(screen.getByRole("tab", { name: /^filterUnread/ }));
      await settle();

      const callsBeforeMarkAll = getNotificationsMock.mock.calls.length;
      await user.click(screen.getByRole("button", { name: "markAllRead" }));
      await waitFor(() => {
        expect(screen.queryByText("first")).toBeNull();
        expect(screen.queryByText("second")).toBeNull();
      });

      expect(screen.getByText("emptyUnreadState")).toBeTruthy();
      expect(screen.queryByTestId("notification-older-boundary")).toBeNull();
      expect(getNotificationsMock.mock.calls.length).toBe(callsBeforeMarkAll);
      expect(getNotificationsMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ cursor: "second" }),
      );
    },
  );

  it.each(FRAMES)(
    "puts a row back when mark-read fails after it left the Unread view in the %s",
    async (_, mount) => {
      const first = row("first", { isRead: false, readAt: null });
      const second = row("second", {
        isRead: false,
        readAt: null,
        createdAt: new Date("2026-06-17T09:00:00.000Z"),
      });
      getNotificationsMock.mockResolvedValue(page([first, second]));
      getNotificationsCountsMock.mockResolvedValue({
        data: { unread: 2, needsAction: 0 },
      });

      let rejectRead!: (error: Error) => void;
      patchNotificationReadMock.mockImplementation(
        () =>
          new Promise((_, reject) => {
            rejectRead = reject;
          }),
      );

      await mount();
      const user = userEvent.setup();

      getNotificationsMock.mockResolvedValue(page([first, second]));
      await user.click(screen.getByRole("tab", { name: /^filterUnread/ }));
      await settle();

      await user.click(screen.getByRole("button", { name: "markRead: first" }));
      await settle();
      await user.unhover(screen.getByText("first"));
      await waitFor(() => {
        expect(screen.queryByText("first")).toBeNull();
      });
      expect(screen.getByText("second")).toBeTruthy();

      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      getNotificationsMock.mockRejectedValue(new Error("offline"));
      await act(async () => {
        rejectRead(new Error("offline"));
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByText("first")).toBeTruthy();
      });
      expect(screen.getByText("second")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "markRead: first" }),
      ).toBeTruthy();
      consoleError.mockRestore();
    },
  );

  it.each(FRAMES)(
    "puts a notification that arrives in the Unread view at the top in the %s",
    async (_, mount) => {
      const waiting = row("waiting", {
        isRead: false,
        readAt: null,
        createdAt: new Date("2026-06-18T09:00:00.000Z"),
      });
      getNotificationsMock.mockResolvedValue(page([waiting]));
      getNotificationsCountsMock.mockResolvedValue({
        data: { unread: 1, needsAction: 0 },
      });

      await mount();

      getNotificationsMock.mockResolvedValue(page([waiting]));
      await userEvent
        .setup()
        .click(screen.getByRole("tab", { name: /^filterUnread/ }));
      await settle();

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
        .getAllByText(/^arrived$|^waiting$/)
        .map((element) => element.textContent);
      expect(messages).toEqual(["arrived", "waiting"]);
    },
  );

  it.each(FRAMES)(
    "tells an empty Unread view from an empty All view in the %s",
    async (_, mount) => {
      getNotificationsMock.mockResolvedValue(
        page([row("mine", { isRead: true })]),
      );

      await mount();
      const user = userEvent.setup();

      getNotificationsMock.mockResolvedValue(page([]));
      await user.click(screen.getByRole("tab", { name: /^filterUnread/ }));
      await settle();
      expect(screen.getByText("emptyUnreadState")).toBeTruthy();
      expect(screen.queryByText("emptyState")).toBeNull();

      getNotificationsMock.mockResolvedValue(page([]));
      await user.click(screen.getByRole("tab", { name: "filterAll" }));
      await settle();
      expect(screen.getByText("emptyState")).toBeTruthy();
      expect(screen.queryByText("emptyUnreadState")).toBeNull();
    },
  );

  it("leaves both empty states out under an account notice", async () => {
    accountNoticeMock.mockReturnValue({ notice: { tone: "warning" } });
    getNotificationsMock.mockResolvedValue(
      page([row("mine", { isRead: false, readAt: null })]),
    );
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 1, needsAction: 0 },
    });

    await renderPage();

    getNotificationsMock.mockResolvedValue(page([]));
    await userEvent
      .setup()
      .click(screen.getByRole("tab", { name: /^filterUnread/ }));
    await settle();

    expect(screen.getByText("account notice")).toBeTruthy();
    expect(screen.queryByText("emptyUnreadState")).toBeNull();
    expect(screen.queryByText("emptyState")).toBeNull();
    // ...and the way back stays on screen.
    expect(screen.getByRole("tab", { name: "filterAll" })).toBeTruthy();
  });

  it.each(FRAMES)(
    "offers a retry that keeps the unread query in the %s",
    async (_, mount) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      getNotificationsMock.mockResolvedValue(
        page([row("mine", { isRead: true })]),
      );

      await mount();
      const user = userEvent.setup();

      getNotificationsMock.mockRejectedValue(new Error("offline"));
      await user.click(screen.getByRole("tab", { name: /^filterUnread/ }));
      await settle();

      expect(screen.getByText("fetchError")).toBeTruthy();

      const waiting = row("waiting", { isRead: false, readAt: null });
      getNotificationsMock.mockResolvedValue(page([waiting]));
      await user.click(screen.getByRole("button", { name: "retry" }));
      await settle();

      expect(getNotificationsMock).toHaveBeenLastCalledWith({
        limit: 20,
        isRead: "false",
      });
      expect(screen.getByText("waiting")).toBeTruthy();
      consoleError.mockRestore();
    },
  );

  it("counts the whole feed on the bell whatever the view", async () => {
    const waiting = row("waiting", { isRead: false, readAt: null });
    const handled = row("handled", { isRead: true });
    getNotificationsMock.mockResolvedValue(page([waiting, handled]));
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 5, needsAction: 0 },
    });

    await renderPanel();
    const user = userEvent.setup();
    const badge = () =>
      screen.getByTestId("notification-unread-badge").textContent;
    expect(badge()).toBe("5");

    getNotificationsMock.mockResolvedValue(page([waiting]));
    await user.click(screen.getByRole("tab", { name: /^filterUnread/ }));
    await settle();
    expect(badge()).toBe("5");

    getNotificationsMock.mockResolvedValue(page([waiting, handled]));
    await user.click(screen.getByRole("tab", { name: "filterAll" }));
    await settle();
    expect(badge()).toBe("5");
  });

  it("switches views from the keyboard", async () => {
    getNotificationsMock.mockResolvedValue(
      page([row("mine", { isRead: true })]),
    );

    await renderPage();
    const user = userEvent.setup();

    expect(screen.getByRole("tablist", { name: "filterLabel" })).toBeTruthy();
    const all = screen.getByRole("tab", { name: "filterAll" });
    for (let step = 0; step < 5 && document.activeElement !== all; step++) {
      await user.tab();
    }
    expect(document.activeElement).toBe(all);

    const waiting = row("waiting", { isRead: false, readAt: null });
    getNotificationsMock.mockResolvedValue(page([waiting]));
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: /^filterUnread/ }),
    );
    await user.keyboard("{Enter}");
    await settle();

    expect(getNotificationsMock).toHaveBeenLastCalledWith({
      limit: 20,
      isRead: "false",
    });
    expect(screen.getByText("waiting")).toBeTruthy();
    expect(
      screen
        .getByRole("tab", { name: /^filterUnread/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("shows the loading rows while the narrowed page is fetched", async () => {
    getNotificationsMock.mockResolvedValue(
      page([row("mine", { isRead: true })]),
    );

    await renderPage();

    const narrowed = Promise.withResolvers<unknown>();
    getNotificationsMock.mockReturnValueOnce(narrowed.promise);
    await userEvent
      .setup()
      .click(screen.getByRole("tab", { name: /^filterUnread/ }));

    expect(screen.getByTestId("notifications-loading-list")).toBeTruthy();
    expect(screen.queryByText("mine")).toBeNull();

    await act(async () => {
      narrowed.resolve(page([row("waiting", { isRead: false, readAt: null })]));
      await Promise.resolve();
    });
    await settle();

    expect(screen.getByText("waiting")).toBeTruthy();
  });
});

/**
 * The Needs you view (SOK-1097). Its rows are requests still open on the
 * record they point at, which Core decides; here the list is whatever Core
 * returns for the flag, and the view's own promises are what get checked:
 * reading never removes a row, a row that never asked stays out, and the
 * count on the tab is Core's.
 */
describe("Notification Center Needs you view", () => {
  const TASK_ASK_KEY = "Notifications.Task.inputRequired";

  function asked(id: string, overrides: Partial<NotificationItem> = {}) {
    return row(id, {
      kind: "TASK",
      messageKey: TASK_ASK_KEY,
      messageParams: { label: id },
      referenceId: `task-${id}`,
      isRead: false,
      readAt: null,
      ...overrides,
    });
  }

  function arrives(
    notification: NotificationItem,
    created = true,
  ): NotificationEventData {
    return {
      ...notification,
      readAt: null,
      createdAt: notification.createdAt.toISOString(),
      inApp: true,
      osBanner: false,
      created,
    } as NotificationEventData;
  }

  it.each(FRAMES)(
    "lists what still waits on the reader, counted on its tab, in the %s",
    async (_, mount) => {
      const waiting = asked("waiting", {
        createdAt: new Date("2026-06-18T09:00:00.000Z"),
      });
      const done = row("done", {
        createdAt: new Date("2026-06-17T09:00:00.000Z"),
      });
      getNotificationsMock.mockResolvedValue(page([waiting, done]));
      getNotificationsCountsMock.mockResolvedValue({
        data: { unread: 1, needsAction: 1 },
      });

      await mount();
      const user = userEvent.setup();

      // Three views, one choice, and the count sits on the tab itself.
      const tabs = screen
        .getAllByRole("tab")
        .map((tab) => tab.textContent?.replace(/\d+$/, ""));
      expect(tabs).toEqual(["filterAll", "filterUnread", "filterNeedsYou"]);
      const needsYou = screen.getByRole("tab", { name: "filterNeedsYou 1" });
      expect(needsYou.getAttribute("aria-selected")).toBe("false");

      getNotificationsMock.mockResolvedValue(page([waiting]));
      await user.click(needsYou);
      await settle();

      expect(getNotificationsMock).toHaveBeenLastCalledWith({
        limit: 20,
        needsAction: "true",
      });
      expect(needsYou.getAttribute("aria-selected")).toBe("true");
      expect(screen.getByText("waiting")).toBeTruthy();
      expect(screen.queryByText("done")).toBeNull();
      // Looking is not a write.
      expect(patchNotificationReadMock).not.toHaveBeenCalled();
      expect(patchNotificationsReadAllMock).not.toHaveBeenCalled();
    },
  );

  it("shows no count on the tab when nothing is waiting", async () => {
    await renderPage();

    expect(screen.getByRole("tab", { name: "filterNeedsYou" })).toBeTruthy();
  });

  it("does not say nothing is waiting while the tab still has a count", async () => {
    getNotificationsMock.mockResolvedValue(page([]));
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 0, needsAction: 2 },
    });

    await renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "filterNeedsYou 2" }));
    await settle();

    expect(screen.queryByText("emptyNeedsYouState")).toBeNull();
    expect(screen.getByRole("tab", { name: "filterNeedsYou 2" })).toBeTruthy();
  });

  it("keeps a read row until the request is answered, then lets it go", async () => {
    const waiting = asked("waiting");
    getNotificationsMock.mockResolvedValue(page([waiting]));
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 1, needsAction: 1 },
    });
    patchNotificationReadMock.mockResolvedValue({
      data: { ...waiting, isRead: true, readAt: new Date() },
    });
    patchNotificationUnreadMock.mockResolvedValue({ data: waiting });

    await renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /^filterNeedsYou/ }));
    await settle();

    await user.click(screen.getByRole("button", { name: "markRead: waiting" }));
    await settle();

    // Read, and still here: the task is still asking.
    expect(screen.getByText("waiting")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "markUnread: waiting" }),
    ).toBeTruthy();

    // And back to unread moves it just as little.
    await user.click(
      screen.getByRole("button", { name: "markUnread: waiting" }),
    );
    await settle();
    expect(screen.getByText("waiting")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "markRead: waiting" }),
    ).toBeTruthy();

    // The next read of the view is what Core says now: answered, gone.
    getNotificationsMock.mockResolvedValue(page([]));
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 0, needsAction: 0 },
    });
    await user.click(screen.getByRole("tab", { name: "filterAll" }));
    await settle();
    await user.click(screen.getByRole("tab", { name: /^filterNeedsYou/ }));
    await settle();

    expect(screen.queryByText("waiting")).toBeNull();
    expect(screen.getByText("emptyNeedsYouState")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "filterNeedsYou" })).toBeTruthy();
  });

  it("admits an arriving request and refreshes its count, and keeps other rows out", async () => {
    getNotificationsMock.mockResolvedValue(page([asked("waiting")]));
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 1, needsAction: 1 },
    });

    // The panel, so the bell is there to show the arrival counted anyway.
    await renderPanel();
    await userEvent
      .setup()
      .click(screen.getByRole("tab", { name: /^filterNeedsYou/ }));
    await settle();
    const countCallsBefore = getNotificationsCountsMock.mock.calls.length;

    await act(async () => {
      deliverRealtime(
        arrives(
          row("finished", {
            isRead: false,
            readAt: null,
            createdAt: new Date("2026-06-18T10:00:00.000Z"),
          }),
        ),
      );
    });
    await settle();

    // A completion is news, but not a request: it goes to the bell, not here.
    expect(screen.queryByText("finished")).toBeNull();
    expect(screen.getByTestId("notification-unread-badge").textContent).toBe(
      "2",
    );

    const another = asked("another", {
      createdAt: new Date("2026-06-18T11:00:00.000Z"),
    });
    getNotificationsMock.mockResolvedValue(page([another, asked("waiting")]));
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 3, needsAction: 2 },
    });
    await act(async () => {
      deliverRealtime(arrives(another));
    });
    await settle();

    expect(screen.getByText("another")).toBeTruthy();
    expect(getNotificationsCountsMock.mock.calls.length).toBeGreaterThan(
      countCallsBefore,
    );
    expect(screen.getByRole("tab", { name: "filterNeedsYou 2" })).toBeTruthy();
  });

  it("keeps the choice the panel made when the page shows the same list", async () => {
    const waiting = asked("waiting");
    getNotificationsMock.mockResolvedValue(page([waiting, row("done")]));
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 1, needsAction: 1 },
    });

    render(
      <NotificationProvider userId="user-1">
        <HeaderNotificationBell />
        <NotificationsPageContent />
      </NotificationProvider>,
    );
    await settle();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /^notifications$|unreadBadge/ }),
    );
    await settle();
    const panel = document.querySelector("[data-slot='popover-content']");
    expect(panel).not.toBeNull();

    getNotificationsMock.mockResolvedValue(page([waiting]));
    await user.click(
      within(panel as HTMLElement).getByRole("tab", {
        name: /^filterNeedsYou/,
      }),
    );
    await settle();

    expect(screen.getAllByText("waiting")).toHaveLength(2);
    expect(screen.queryByText("done")).toBeNull();
    for (const option of screen.getAllByRole("tab", {
      name: /^filterNeedsYou/,
    })) {
      expect(option.getAttribute("aria-selected")).toBe("true");
    }
  });
});

/**
 * The remembered view (SOK-1108). The view strip is a lens the reader picks,
 * and the Notification Center keeps that pick per browser. What is checked
 * here is what a reader meets: which tab reads as selected, and which query
 * the *first* Core call carried. That first call is the point: a restore that
 * lands after the list has already been fetched costs a second round trip and
 * flashes All on the way.
 */
describe("Notification Center remembered view", () => {
  const TASK_ASK_KEY = "Notifications.Task.inputRequired";

  function stored(view: string) {
    window.localStorage.setItem(NOTIFICATION_VIEW_STORAGE_KEY, view);
  }

  /** A row the Needs you view keeps: one that asked the reader something. */
  function asking(id: string, createdAt?: Date) {
    return row(id, {
      kind: "TASK",
      messageKey: TASK_ASK_KEY,
      messageParams: { label: id },
      isRead: false,
      readAt: null,
      ...(createdAt === undefined ? {} : { createdAt }),
    });
  }

  it.each(FRAMES)(
    "opens on the remembered Needs you view in the %s",
    async (_, mount) => {
      stored("needs-action");
      getNotificationsMock.mockResolvedValue(page([asking("waiting")]));
      getNotificationsCountsMock.mockResolvedValue({
        data: { unread: 1, needsAction: 1 },
      });

      await mount();

      // The first call, not the eventual one: no All page was ever asked for.
      expect(getNotificationsMock).toHaveBeenCalledTimes(1);
      expect(getNotificationsMock).toHaveBeenCalledWith({
        limit: 20,
        needsAction: "true",
      });
      // The count is Core's, and it is the count of the whole view, so a
      // restored view shows the same number a switched-to one would.
      for (const tab of screen.getAllByRole("tab", {
        name: "filterNeedsYou 1",
      })) {
        expect(tab.getAttribute("aria-selected")).toBe("true");
      }
      expect(screen.getAllByText("waiting").length).toBeGreaterThan(0);
      // A remembered lens is still a lens.
      expect(patchNotificationReadMock).not.toHaveBeenCalled();
      expect(patchNotificationsReadAllMock).not.toHaveBeenCalled();
    },
  );

  it("opens on the remembered Unread view", async () => {
    stored("unread");

    await renderPage();

    expect(getNotificationsMock).toHaveBeenCalledTimes(1);
    expect(getNotificationsMock).toHaveBeenCalledWith({
      limit: 20,
      isRead: "false",
    });
    expect(
      screen
        .getByRole("tab", { name: /^filterUnread/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("opens on All when nothing is stored", async () => {
    await renderPage();

    expect(getNotificationsMock).toHaveBeenCalledWith({ limit: 20 });
    expect(
      screen
        .getByRole("tab", { name: "filterAll" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("falls back to All on a value it does not recognise, and drops it", async () => {
    stored("needsAction");

    await renderPage();

    expect(getNotificationsMock).toHaveBeenCalledWith({ limit: 20 });
    expect(
      screen
        .getByRole("tab", { name: "filterAll" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      window.localStorage.getItem(NOTIFICATION_VIEW_STORAGE_KEY),
    ).toBeNull();
  });

  it.each(FRAMES)("remembers a switch made in the %s", async (_, mount) => {
    await mount();
    const user = userEvent.setup();

    await user.click(
      screen.getAllByRole("tab", { name: /^filterNeedsYou/ })[0] as HTMLElement,
    );
    await settle();

    expect(window.localStorage.getItem(NOTIFICATION_VIEW_STORAGE_KEY)).toBe(
      "needs-action",
    );

    await user.click(
      screen.getAllByRole("tab", { name: /^filterUnread/ })[0] as HTMLElement,
    );
    await settle();

    // The last switch wins.
    expect(window.localStorage.getItem(NOTIFICATION_VIEW_STORAGE_KEY)).toBe(
      "unread",
    );
  });

  it("reads back the view a previous mount stored", async () => {
    await renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /^filterUnread/ }));
    await settle();

    cleanup();
    getNotificationsMock.mockClear();

    await renderPage();

    expect(getNotificationsMock).toHaveBeenCalledTimes(1);
    expect(getNotificationsMock).toHaveBeenCalledWith({
      limit: 20,
      isRead: "false",
    });
  });
  it("pages older rows under the remembered view", async () => {
    stored("needs-action");
    getNotificationsMock.mockResolvedValue(
      page(
        [
          asking("newest", new Date("2026-06-18T09:00:00.000Z")),
          asking("oldest-loaded", new Date("2026-06-17T09:00:00.000Z")),
        ],
        "oldest-loaded",
      ),
    );
    // The boundary only arms while the view's own count says Core has more.
    getNotificationsCountsMock.mockResolvedValue({
      data: { unread: 2, needsAction: 2 },
    });

    await renderPage();

    getNotificationsMock.mockResolvedValue(
      page([asking("older", new Date("2026-06-16T09:00:00.000Z"))]),
    );
    await act(async () => {
      intersect(screen.getByTestId("notification-older-boundary"));
      await Promise.resolve();
    });

    // The older page asks under the remembered view, not under All.
    expect(getNotificationsMock).toHaveBeenLastCalledWith({
      limit: 20,
      cursor: "oldest-loaded",
      needsAction: "true",
    });
    expect(screen.getByText("older")).toBeTruthy();
  });

  it("shows the remembered view in both frames at once", async () => {
    stored("needs-action");
    getNotificationsMock.mockResolvedValue(page([asking("waiting")]));

    render(
      <NotificationProvider userId="user-1">
        <HeaderNotificationBell />
        <NotificationsPageContent />
      </NotificationProvider>,
    );
    await settle();
    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: /^notifications$|unreadBadge/ }),
      );
    await settle();

    const tabs = screen.getAllByRole("tab", { name: /^filterNeedsYou/ });
    expect(tabs.length).toBe(2);
    for (const tab of tabs) {
      expect(tab.getAttribute("aria-selected")).toBe("true");
    }
    expect(getNotificationsMock).toHaveBeenCalledTimes(1);
  });

  it("opens on All when localStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    getNotificationsMock.mockResolvedValue(page([row("only")]));

    await renderPage();

    expect(getNotificationsMock).toHaveBeenCalledWith({ limit: 20 });
    expect(screen.getByText("only")).toBeTruthy();
    expect(
      screen
        .getByRole("tab", { name: "filterAll" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });
});
