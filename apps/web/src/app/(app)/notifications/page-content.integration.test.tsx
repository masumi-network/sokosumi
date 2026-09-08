import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationDeletionEvent } from "@/contexts/notification-provider";
import type { NotificationItem } from "@/lib/clients/generated/core";

import { NotificationsPageContent } from "./page-content";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  delete: vi.fn(),
  clear: vi.fn(),
  subscribe: vi.fn(),
  notifications: [] as NotificationItem[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: null }),
}));
vi.mock("@/contexts/account-notice-provider", () => ({
  useAccountNotice: () => ({ notice: null }),
}));
vi.mock("@/contexts/notification-provider", () => ({
  useNotifications: () => ({
    notifications: mocks.notifications,
    unreadCount: 0,
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    deleteNotification: mocks.delete,
    clearNotifications: mocks.clear,
    subscribeToDeletion: mocks.subscribe,
  }),
}));
vi.mock("@/lib/clients/core.notifications.browser.client", () => ({
  notificationsBrowserClient: { getNotifications: mocks.get },
}));
vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: () => ({ handleSelectWorkspace: vi.fn() }),
}));
vi.mock("@/app/components/account-notice-row", () => ({
  AccountNoticeRow: () => null,
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
vi.mock("@/components/notifications/clear-notifications-dialog", () => ({
  ClearNotificationsDialog: () => null,
}));

function notification(id: string): NotificationItem {
  return {
    id,
    userId: "user",
    kind: "JOB",
    referenceId: "job",
    eventId: "event",
    messageKey: id,
    messageParams: {},
    metadata: null,
    isRead: true,
    readAt: new Date(),
    createdAt: new Date(),
  };
}

function response(rows: NotificationItem[], nextCursor: string | null = null) {
  return { data: rows, meta: { pagination: { nextCursor } } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("notification page deletions", () => {
  let listener: ((event: NotificationDeletionEvent) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notifications = [];
    mocks.get.mockReset();
    mocks.delete.mockReset();
    mocks.clear.mockReset();
    mocks.subscribe.mockImplementation((nextListener) => {
      listener = nextListener;
      return () => {
        listener = undefined;
      };
    });
    listener = undefined;
  });

  async function mount(
    rows = [notification("first"), notification("last")],
    cursor: string | null = null,
  ) {
    mocks.notifications = rows.slice(0, 1);
    mocks.get.mockResolvedValue(response(rows, cursor));
    const view = render(<NotificationsPageContent userId="user" />);
    await screen.findByText(rows[0].messageKey);
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));
    return view;
  }

  function emit(event: NotificationDeletionEvent) {
    act(() => {
      listener?.(event);
    });
  }

  it("removes bell deletions from the mounted page and restores an offline failure", async () => {
    const view = await mount();
    emit({ operationId: 1, phase: "start", kind: "delete", id: "first" });
    mocks.notifications = [];
    view.rerender(<NotificationsPageContent userId="user" />);
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.getByText("last")).toBeInTheDocument();
    emit({ operationId: 1, phase: "failure", kind: "delete", id: "first" });
    expect(screen.getByText("first")).toBeInTheDocument();
  });

  it("clears page rows outside the bell window and restores them on failure", async () => {
    const view = await mount();
    emit({ operationId: 1, phase: "start", kind: "clear" });
    mocks.notifications = [];
    view.rerender(<NotificationsPageContent userId="user" />);
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.queryByText("last")).not.toBeInTheDocument();
    emit({ operationId: 1, phase: "failure", kind: "clear" });
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("last")).toBeInTheDocument();
  });

  it("replaces a deleted cursor with the last surviving row", async () => {
    await mount(undefined, "last");
    mocks.delete.mockImplementation(async ({ id }: { id: string }) => ({
      data: notification(id),
    }));
    emit({ operationId: 1, phase: "start", kind: "delete", id: "last" });
    emit({ operationId: 1, phase: "success", kind: "delete", id: "last" });
    mocks.get.mockResolvedValue(response([notification("older")]));
    fireEvent.click(screen.getByRole("button", { name: "loadMore" }));
    await screen.findByText("older");
    expect(mocks.get).toHaveBeenLastCalledWith({ limit: 20, cursor: "first" });
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.queryByText("last")).not.toBeInTheDocument();
  });

  it("rejects a load-more response started before clearing", async () => {
    await mount(undefined, "last");
    const pending = deferred<ReturnType<typeof response>>();
    mocks.get.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "loadMore" }));
    emit({ operationId: 1, phase: "start", kind: "clear" });
    emit({ operationId: 1, phase: "success", kind: "clear" });
    await act(async () => {
      pending.resolve(response([notification("older")], "older"));
    });
    expect(screen.queryByText("older")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "loadMore" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("emptyState")).toBeInTheDocument();
  });

  it("does not restore a successful delete when an overlapping clear fails", async () => {
    await mount();
    emit({ operationId: 1, phase: "start", kind: "delete", id: "first" });
    emit({ operationId: 2, phase: "start", kind: "clear" });
    emit({ operationId: 1, phase: "success", kind: "delete", id: "first" });
    emit({ operationId: 2, phase: "failure", kind: "clear" });
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.getByText("last")).toBeInTheDocument();
  });

  it("does not restore an earlier delete after a successful clear", async () => {
    await mount();
    emit({ operationId: 1, phase: "start", kind: "delete", id: "first" });
    emit({ operationId: 2, phase: "start", kind: "clear" });
    emit({ operationId: 2, phase: "success", kind: "clear" });
    emit({ operationId: 1, phase: "failure", kind: "delete", id: "first" });
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.queryByText("last")).not.toBeInTheDocument();
  });

  it("keeps new provider rows and updates when a clear fails", async () => {
    const view = await mount();
    emit({ operationId: 1, phase: "start", kind: "clear" });
    mocks.notifications = [
      notification("new"),
      { ...notification("first"), messageKey: "updated" },
    ];
    view.rerender(<NotificationsPageContent userId="user" />);
    emit({ operationId: 1, phase: "failure", kind: "clear" });
    expect(screen.getByText("new")).toBeInTheDocument();
    expect(screen.getByText("updated")).toBeInTheDocument();
    expect(screen.getByText("last")).toBeInTheDocument();
    expect(screen.queryByText("first")).not.toBeInTheDocument();
  });

  it("rejects the initial page response when the bell clears before it arrives", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    mocks.notifications = [notification("first")];
    mocks.get.mockReturnValueOnce(pending.promise);
    render(<NotificationsPageContent userId="user" />);
    await screen.findByText("first");
    emit({ operationId: 1, phase: "start", kind: "clear" });
    emit({ operationId: 1, phase: "success", kind: "clear" });
    await act(async () => {
      pending.resolve(
        response([notification("first"), notification("older")], "older"),
      );
    });
    expect(screen.queryByText("older")).not.toBeInTheDocument();
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.getByText("emptyState")).toBeInTheDocument();
  });

  it("waits for an existing bell deletion before loading the page", async () => {
    mocks.subscribe.mockImplementation((nextListener) => {
      listener = nextListener;
      nextListener({
        operationId: 1,
        phase: "start",
        kind: "delete",
        id: "first",
      });
      return () => {
        listener = undefined;
      };
    });
    mocks.get.mockResolvedValue(response([notification("last")]));
    render(<NotificationsPageContent userId="user" />);
    expect(mocks.get).not.toHaveBeenCalled();
    emit({ operationId: 1, phase: "success", kind: "delete", id: "first" });
    await screen.findByText("last");
    expect(screen.queryByText("first")).not.toBeInTheDocument();
  });

  it("shows the ordinary empty state after clearing a previously failed page load", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.notifications = [notification("first")];
    mocks.get.mockRejectedValue(new Error("offline"));
    render(<NotificationsPageContent userId="user" />);
    await screen.findByText("first");
    await waitFor(() => expect(error).toHaveBeenCalled());
    emit({ operationId: 1, phase: "start", kind: "clear" });
    emit({ operationId: 1, phase: "success", kind: "clear" });
    expect(screen.getByText("emptyState")).toBeInTheDocument();
    expect(screen.queryByText("fetchError")).not.toBeInTheDocument();
    error.mockRestore();
  });
});
