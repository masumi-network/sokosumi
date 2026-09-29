import { describe, expect, it } from "vitest";

import { notificationReducer } from "@/contexts/notification-state";
import type { NotificationItem } from "@/lib/clients/generated/core";

function createNotification(
  overrides: Partial<NotificationItem> = {},
): NotificationItem {
  return {
    id: "notification-1",
    userId: "user-1",
    kind: "JOB",
    referenceId: "job-1",
    eventId: "event-1",
    messageKey: "Notifications.Job.completed",
    messageParams: {},
    metadata: { agentId: "agent-1" },
    isRead: false,
    readAt: null,
    createdAt: new Date("2026-06-18T09:00:00.000Z"),
    ...overrides,
  };
}

describe("notificationReducer", () => {
  it("ignores CHAT realtime events for the in-app feed", () => {
    const chatNotification = createNotification({
      id: "notification-chat",
      kind: "CHAT",
      referenceId: "room-1",
      messageKey: "Notifications.Chat.directMessage",
    });

    const afterRealtime = notificationReducer(
      {
        notifications: [],
        unreadCount: 0,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      { type: "realtime", notification: chatNotification, created: true },
    );

    expect(afterRealtime.notifications).toEqual([]);
    expect(afterRealtime.unreadCount).toBe(0);
  });

  it("drops stale CHAT items on fetch_success instead of keeping them as pending", () => {
    const staleChat = createNotification({
      id: "notification-chat-stale",
      kind: "CHAT",
      referenceId: "room-1",
      messageKey: "Notifications.Chat.directMessage",
    });
    const job = createNotification({
      id: "notification-job",
      kind: "JOB",
    });

    const afterFetch = notificationReducer(
      {
        notifications: [staleChat],
        unreadCount: 1,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      {
        type: "fetch_success",
        realtimeIds: new Set(["notification-realtime"]),
        fetched: [job],
        hasMore: false,
        serverUnreadCount: 1,
        serverNeedsActionCount: 0,
        serverMentionsCount: 0,
        view: "all",
      },
    );

    expect(afterFetch.notifications.map((n) => n.id)).toEqual([job.id]);
    expect(afterFetch.unreadCount).toBe(1);
  });

  it("does not decrement in-app unread when mark-read succeeds for a CHAT not in the feed", () => {
    const job = createNotification({
      id: "notification-job",
      kind: "JOB",
    });
    const chatRead = createNotification({
      id: "notification-chat",
      kind: "CHAT",
      referenceId: "room-1",
      messageKey: "Notifications.Chat.directMessage",
      isRead: true,
      readAt: new Date("2026-06-18T10:00:00.000Z"),
    });

    const afterMarkRead = notificationReducer(
      {
        notifications: [job],
        unreadCount: 1,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      {
        type: "mark_read_success",
        id: chatRead.id,
        updated: chatRead,
      },
    );

    expect(afterMarkRead.notifications).toEqual([job]);
    expect(afterMarkRead.unreadCount).toBe(1);
  });

  it("removes a notification and decrements unread when it was unread", () => {
    const unread = createNotification({ id: "n1", isRead: false });
    const read = createNotification({ id: "n2", isRead: true });

    const afterRemove = notificationReducer(
      {
        notifications: [unread, read],
        unreadCount: 1,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      { type: "remove", id: "n1" },
    );

    expect(afterRemove.notifications.map((n) => n.id)).toEqual(["n2"]);
    expect(afterRemove.unreadCount).toBe(0);
  });

  it("removes a read notification without changing unread count", () => {
    const unread = createNotification({ id: "n1", isRead: false });
    const read = createNotification({ id: "n2", isRead: true });

    const afterRemove = notificationReducer(
      {
        notifications: [unread, read],
        unreadCount: 1,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      { type: "remove", id: "n2" },
    );

    expect(afterRemove.notifications.map((n) => n.id)).toEqual(["n1"]);
    expect(afterRemove.unreadCount).toBe(1);
  });

  it("drops the Needs you count when a waiting row is removed", () => {
    const waiting = createNotification({
      id: "n-grant",
      kind: "SYSTEM",
      messageKey: "notifications.vendorGrant.pending",
      isRead: true,
    });
    const news = createNotification({ id: "n-news", isRead: true });

    const afterRemove = notificationReducer(
      {
        notifications: [waiting, news],
        unreadCount: 0,
        needsActionCount: 1,
        mentionsCount: 0,
      },
      { type: "remove", id: "n-grant" },
    );

    expect(afterRemove.notifications.map((n) => n.id)).toEqual(["n-news"]);
    expect(afterRemove.needsActionCount).toBe(0);
    expect(afterRemove.unreadCount).toBe(0);
  });

  it("leaves the Needs you count when a row that never asked is removed", () => {
    const news = createNotification({ id: "n-news", isRead: false });

    const afterRemove = notificationReducer(
      {
        notifications: [news],
        unreadCount: 1,
        needsActionCount: 2,
        mentionsCount: 0,
      },
      { type: "remove", id: "n-news" },
    );

    expect(afterRemove.notifications).toEqual([]);
    expect(afterRemove.unreadCount).toBe(0);
    expect(afterRemove.needsActionCount).toBe(2);
  });

  it("applies fetch and realtime updates atomically without losing unread count", () => {
    const realtimeNotification = createNotification({
      id: "notification-realtime",
    });
    const fetchedNotification = createNotification({
      id: "notification-fetched",
      isRead: true,
    });

    const afterRealtime = notificationReducer(
      {
        notifications: [],
        unreadCount: 0,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      { type: "realtime", notification: realtimeNotification, created: true },
    );

    const afterFetch = notificationReducer(afterRealtime, {
      type: "fetch_success",
      realtimeIds: new Set(["notification-realtime"]),
      fetched: [fetchedNotification],
      hasMore: false,
      serverUnreadCount: 0,
      serverNeedsActionCount: 0,
      serverMentionsCount: 0,
      view: "all",
    });

    expect(
      afterFetch.notifications.map((notification) => notification.id),
    ).toEqual(["notification-realtime", "notification-fetched"]);
    expect(afterFetch.unreadCount).toBe(1);
  });

  /**
   * A room's later messages arrive as changes to the row the first one wrote.
   * The reader can hold more unread rows than this list keeps, so a change can
   * land for a row the list has never seen, and counting it would put the
   * badge one ahead of the server for the rest of the session.
   */
  it("does not count a changed row the list never loaded", () => {
    const counted = createNotification({ id: "notification-counted" });

    const after = notificationReducer(
      {
        notifications: [],
        unreadCount: 12,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      { type: "realtime", notification: counted, created: false },
    );

    expect(after.unreadCount).toBe(12);
    expect(after.notifications.map((one) => one.id)).toEqual([
      "notification-counted",
    ]);
  });

  it("counts a row the list never loaded when the event wrote it", () => {
    const written = createNotification({ id: "notification-written" });

    const after = notificationReducer(
      {
        notifications: [],
        unreadCount: 12,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      { type: "realtime", notification: written, created: true },
    );

    expect(after.unreadCount).toBe(13);
  });

  /**
   * A room's row moves to the top of the feed when a message counts onto it.
   * Left where it was, the list would disagree with the order the next read
   * returns: the same rows, in a different order, for no reason the reader
   * can see.
   */
  it("moves a row that came back newer to the front", () => {
    const older = createNotification({
      id: "notification-room",
      createdAt: new Date("2026-01-01T09:00:00.000Z"),
    });
    const newer = createNotification({
      id: "notification-job",
      createdAt: new Date("2026-01-01T10:00:00.000Z"),
    });

    const loaded = notificationReducer(
      {
        notifications: [newer, older],
        unreadCount: 2,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      {
        type: "realtime",
        notification: {
          ...older,
          createdAt: new Date("2026-01-01T11:00:00.000Z"),
        },
        created: false,
      },
    );

    expect(loaded.notifications.map((one) => one.id)).toEqual([
      "notification-room",
      "notification-job",
    ]);
    expect(loaded.unreadCount).toBe(2);
  });

  /**
   * A room read clears its rows on the server and says so over the same
   * channel. The badge has to come down with them.
   */
  it("takes a loaded row off the badge when it comes back read", () => {
    const unread = createNotification({ id: "notification-read-later" });

    const loaded = notificationReducer(
      {
        notifications: [],
        unreadCount: 0,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      { type: "realtime", notification: unread, created: true },
    );

    const after = notificationReducer(loaded, {
      type: "realtime",
      notification: { ...unread, isRead: true },
      created: false,
    });

    expect(after.unreadCount).toBe(0);
  });

  it("ignores a read update for a row outside the local window", () => {
    const visible = createNotification({ id: "notification-visible" });
    const cleared = createNotification({
      id: "notification-cleared",
      isRead: true,
      readAt: new Date("2026-01-01T11:00:00.000Z"),
    });
    const state = {
      notifications: [visible],
      unreadCount: 2,
      needsActionCount: 0,
      mentionsCount: 0,
    };

    const after = notificationReducer(state, {
      type: "realtime",
      notification: cleared,
      created: false,
    });

    expect(after).toBe(state);
  });

  it("does not double-count unread realtime items already included in server count", () => {
    const realtimeNotification = createNotification({
      id: "notification-realtime",
    });

    const afterRealtime = notificationReducer(
      {
        notifications: [],
        unreadCount: 0,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      { type: "realtime", notification: realtimeNotification, created: true },
    );

    const afterFetch = notificationReducer(afterRealtime, {
      type: "fetch_success",
      realtimeIds: new Set(["notification-realtime"]),
      fetched: [],
      hasMore: false,
      serverUnreadCount: 1,
      serverNeedsActionCount: 0,
      serverMentionsCount: 0,
      view: "all",
    });

    expect(afterFetch.unreadCount).toBe(1);
  });

  it("marks a notification read optimistically without waiting on the server payload", () => {
    const unread = createNotification({ id: "notification-unread" });

    const afterOptimistic = notificationReducer(
      {
        notifications: [unread],
        unreadCount: 1,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      { type: "mark_read_optimistic", id: unread.id },
    );

    expect(afterOptimistic.notifications[0]?.isRead).toBe(true);
    expect(afterOptimistic.unreadCount).toBe(0);

    const serverUpdated = createNotification({
      id: unread.id,
      isRead: true,
      readAt: new Date("2026-06-18T10:00:00.000Z"),
    });

    const afterSuccess = notificationReducer(afterOptimistic, {
      type: "mark_read_success",
      id: unread.id,
      updated: serverUpdated,
    });

    expect(afterSuccess.notifications[0]).toEqual(serverUpdated);
    expect(afterSuccess.unreadCount).toBe(0);
  });

  it("keeps a browser-only row off the badge when the server confirms it unread", () => {
    // A CHAT row outside the feed's exceptions never counted towards the
    // in-app badge, so confirming it unread must not add it to one.
    const browserOnly = createNotification({
      id: "notification-chat",
      kind: "CHAT",
      messageKey: "Notifications.Chat.directMessage",
      isRead: true,
      readAt: new Date("2026-06-18T09:30:00.000Z"),
    });

    const after = notificationReducer(
      {
        notifications: [browserOnly],
        unreadCount: 0,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      {
        type: "mark_unread_success",
        id: browserOnly.id,
        updated: { ...browserOnly, isRead: false, readAt: null },
      },
    );

    expect(after.unreadCount).toBe(0);
    expect(after.notifications[0]?.isRead).toBe(true);
  });

  it("puts a read row back on the badge once and only once", () => {
    const read = createNotification({
      id: "notification-read",
      isRead: true,
      readAt: new Date("2026-06-18T09:30:00.000Z"),
    });

    const afterOptimistic = notificationReducer(
      {
        notifications: [read],
        unreadCount: 0,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      { type: "mark_unread_optimistic", id: read.id },
    );

    expect(afterOptimistic.notifications[0]?.isRead).toBe(false);
    expect(afterOptimistic.unreadCount).toBe(1);

    const serverUpdated = createNotification({
      id: read.id,
      isRead: false,
      readAt: null,
    });

    // The optimistic pass already counted it, so the server's confirmation
    // must not count it a second time.
    const afterSuccess = notificationReducer(afterOptimistic, {
      type: "mark_unread_success",
      id: read.id,
      updated: serverUpdated,
    });

    expect(afterSuccess.notifications[0]).toEqual(serverUpdated);
    expect(afterSuccess.unreadCount).toBe(1);
  });

  /**
   * Switching views restarts the list: rows loaded under one view speak for
   * ranges the other never asked for, so none carry over. The badge counts
   * the whole feed whatever the view, so it stays.
   */
  it("clears the rows but keeps the badge when the list restarts", () => {
    const unread = createNotification({ id: "unread", isRead: false });
    const read = createNotification({
      id: "read",
      isRead: true,
      readAt: new Date("2026-06-18T09:30:00.000Z"),
    });

    const state = notificationReducer(
      {
        notifications: [unread, read],
        unreadCount: 1,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      { type: "reset_list" },
    );

    expect(state.notifications).toEqual([]);
    expect(state.unreadCount).toBe(1);
  });

  it("is a no-op when optimistically marking an already-read notification", () => {
    const readNotification = createNotification({
      id: "notification-read",
      isRead: true,
      readAt: new Date("2026-06-18T09:30:00.000Z"),
    });
    const state = {
      notifications: [readNotification],
      unreadCount: 0,
      needsActionCount: 0,
      mentionsCount: 0,
    };

    const next = notificationReducer(state, {
      type: "mark_read_optimistic",
      id: readNotification.id,
    });

    expect(next).toBe(state);
  });
  it("keeps an unread realtime change when the fetched row is stale", () => {
    const current = createNotification();
    const state = notificationReducer(
      {
        notifications: [current],
        unreadCount: 1,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      {
        type: "fetch_success",
        realtimeIds: new Set([current.id]),
        fetched: [{ ...current, isRead: true }],
        hasMore: false,
        serverUnreadCount: 0,
        serverNeedsActionCount: 0,
        serverMentionsCount: 0,
        view: "all",
      },
    );
    expect(state.notifications[0]?.isRead).toBe(false);
    expect(state.unreadCount).toBe(1);
  });

  it("keeps the live badge when count already includes a realtime read", () => {
    const current = createNotification({ isRead: true });
    const state = notificationReducer(
      {
        notifications: [current],
        unreadCount: 10,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      {
        type: "fetch_success",
        realtimeIds: new Set([current.id]),
        fetched: [{ ...current, isRead: false }],
        hasMore: false,
        serverUnreadCount: 10,
        serverNeedsActionCount: 0,
        serverMentionsCount: 0,
        view: "all",
      },
    );
    expect(state.notifications[0]?.isRead).toBe(true);
    expect(state.unreadCount).toBe(10);
  });

  /**
   * The list is one growing window now: the reader scrolls, older pages
   * arrive, and a refresh of the newest page must not throw the rest away.
   */
  it("keeps rows older than the refreshed page", () => {
    const newest = createNotification({
      id: "newest",
      createdAt: new Date("2026-06-18T09:00:00.000Z"),
      isRead: true,
    });
    const older = createNotification({
      id: "older",
      createdAt: new Date("2026-06-17T09:00:00.000Z"),
      isRead: true,
    });

    const state = notificationReducer(
      {
        notifications: [newest, older],
        unreadCount: 0,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      {
        type: "fetch_success",
        realtimeIds: new Set<string>(),
        fetched: [newest],
        hasMore: true,
        serverUnreadCount: 0,
        serverNeedsActionCount: 0,
        serverMentionsCount: 0,
        view: "all",
      },
    );

    expect(state.notifications.map((one) => one.id)).toEqual([
      "newest",
      "older",
    ]);
  });

  /**
   * A refresh in the Unread view prunes what the reader has handled: rows the
   * list still holds below the fetched page stay only while still unread, so
   * a read from another tab converges the next time the list refreshes.
   */
  it("keeps below-page rows on an Unread refresh only while still unread", () => {
    const newest = createNotification({
      id: "newest",
      createdAt: new Date("2026-06-18T09:00:00.000Z"),
      isRead: false,
      readAt: null,
    });
    const waiting = createNotification({
      id: "waiting",
      createdAt: new Date("2026-06-17T09:00:00.000Z"),
      isRead: false,
      readAt: null,
    });
    const handledElsewhere = createNotification({
      id: "handled-elsewhere",
      createdAt: new Date("2026-06-16T09:00:00.000Z"),
      isRead: true,
      readAt: new Date("2026-06-16T10:00:00.000Z"),
    });

    const state = notificationReducer(
      {
        notifications: [newest, waiting, handledElsewhere],
        unreadCount: 2,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      {
        type: "fetch_success",
        realtimeIds: new Set<string>(),
        fetched: [newest],
        hasMore: true,
        serverUnreadCount: 2,
        serverNeedsActionCount: 0,
        serverMentionsCount: 0,
        view: "unread",
      },
    );

    expect(state.notifications.map((one) => one.id)).toEqual([
      "newest",
      "waiting",
    ]);
  });

  it("drops a held row the refreshed page covers but no longer lists", () => {
    const newest = createNotification({
      id: "newest",
      createdAt: new Date("2026-06-18T09:00:00.000Z"),
      isRead: true,
    });
    const resolved = createNotification({
      id: "resolved",
      createdAt: new Date("2026-06-18T08:00:00.000Z"),
      isRead: true,
    });
    const oldest = createNotification({
      id: "oldest",
      createdAt: new Date("2026-06-18T07:00:00.000Z"),
      isRead: true,
    });

    const state = notificationReducer(
      {
        notifications: [newest, resolved, oldest],
        unreadCount: 0,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      {
        type: "fetch_success",
        realtimeIds: new Set<string>(),
        fetched: [newest, oldest],
        hasMore: true,
        serverUnreadCount: 0,
        serverNeedsActionCount: 0,
        serverMentionsCount: 0,
        view: "all",
      },
    );

    expect(state.notifications.map((one) => one.id)).toEqual([
      "newest",
      "oldest",
    ]);
  });

  it("drops rows past the end when the refreshed page is the whole feed", () => {
    const newest = createNotification({ id: "newest", isRead: true });
    const stale = createNotification({
      id: "stale",
      createdAt: new Date("2026-06-10T09:00:00.000Z"),
      isRead: true,
    });

    const state = notificationReducer(
      {
        notifications: [newest, stale],
        unreadCount: 0,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      {
        type: "fetch_success",
        realtimeIds: new Set<string>(),
        fetched: [newest],
        hasMore: false,
        serverUnreadCount: 0,
        serverNeedsActionCount: 0,
        serverMentionsCount: 0,
        view: "all",
      },
    );

    expect(state.notifications.map((one) => one.id)).toEqual(["newest"]);
  });

  it("keeps every row the reader has loaded, past the old ten-row window", () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      createNotification({
        id: `row-${index}`,
        isRead: true,
        createdAt: new Date(Date.UTC(2026, 5, 18, 12 - index)),
      }),
    );

    const state = notificationReducer(
      {
        notifications: [],
        unreadCount: 0,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      {
        type: "fetch_success",
        realtimeIds: new Set<string>(),
        fetched: rows,
        hasMore: false,
        serverUnreadCount: 0,
        serverNeedsActionCount: 0,
        serverMentionsCount: 0,
        view: "all",
      },
    );

    expect(state.notifications).toHaveLength(12);
  });

  it("appends an older page under the rows already loaded", () => {
    const loaded = createNotification({
      id: "loaded",
      createdAt: new Date("2026-06-18T09:00:00.000Z"),
      isRead: true,
    });
    const older = createNotification({
      id: "older",
      createdAt: new Date("2026-06-17T09:00:00.000Z"),
      isRead: true,
    });

    const state = notificationReducer(
      {
        notifications: [loaded],
        unreadCount: 3,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      { type: "load_older_success", fetched: [older] },
    );

    expect(state.notifications.map((one) => one.id)).toEqual([
      "loaded",
      "older",
    ]);
    // The badge is the server's whole-feed count; reaching further back into
    // the same feed cannot add to it.
    expect(state.unreadCount).toBe(3);
  });

  it("keeps the row it already holds when an older page repeats it", () => {
    const held = createNotification({ id: "held", isRead: true });

    const state = notificationReducer(
      {
        notifications: [held],
        unreadCount: 0,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      {
        type: "load_older_success",
        fetched: [{ ...held, isRead: false, readAt: null }],
      },
    );

    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]?.isRead).toBe(true);
  });

  it("leaves a browser-only row out of an older page", () => {
    const directMessage = createNotification({
      id: "direct-message",
      kind: "CHAT",
      messageKey: "Notifications.Chat.directMessage",
    });

    const state = notificationReducer(
      {
        notifications: [],
        unreadCount: 0,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      { type: "load_older_success", fetched: [directMessage] },
    );

    expect(state.notifications).toEqual([]);
  });

  /**
   * Another tab put an old row back to unread. The event carries the row's
   * own time, which sorts it past the end of what this list has loaded, and
   * holding it there would make it the row the next page is fetched from:
   * everything between would never load.
   */
  it("leaves an unloaded row out when an event places it past the end", () => {
    const loaded = createNotification({
      id: "loaded",
      isRead: true,
      createdAt: new Date("2026-06-18T09:00:00.000Z"),
    });
    const farBack = createNotification({
      id: "far-back",
      isRead: false,
      readAt: null,
      createdAt: new Date("2026-05-01T09:00:00.000Z"),
    });

    const state = notificationReducer(
      {
        notifications: [loaded],
        unreadCount: 0,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      { type: "realtime", notification: farBack, created: false },
    );

    expect(state.notifications.map((one) => one.id)).toEqual(["loaded"]);
  });

  it("still takes a changed row that sorts inside the loaded range", () => {
    const newest = createNotification({
      id: "newest",
      isRead: true,
      createdAt: new Date("2026-06-18T09:00:00.000Z"),
    });
    const oldest = createNotification({
      id: "oldest",
      isRead: true,
      createdAt: new Date("2026-06-10T09:00:00.000Z"),
    });
    const room = createNotification({
      id: "room",
      isRead: false,
      readAt: null,
      createdAt: new Date("2026-06-19T09:00:00.000Z"),
    });

    const state = notificationReducer(
      {
        notifications: [newest, oldest],
        unreadCount: 0,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      { type: "realtime", notification: room, created: false },
    );

    expect(state.notifications.map((one) => one.id)).toEqual([
      "room",
      "newest",
      "oldest",
    ]);
  });

  /**
   * More rows arrived than one page holds while the list was not listening.
   * The refreshed page then ends above everything that was loaded, and
   * keeping those rows would leave the ones between them out for good.
   */
  it("starts over from the refreshed page when it does not reach the loaded rows", () => {
    const loaded = createNotification({
      id: "loaded",
      isRead: true,
      createdAt: new Date("2026-06-10T09:00:00.000Z"),
    });
    const arrived = createNotification({
      id: "arrived",
      isRead: true,
      createdAt: new Date("2026-06-18T09:00:00.000Z"),
    });

    const state = notificationReducer(
      {
        notifications: [loaded],
        unreadCount: 0,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      {
        type: "fetch_success",
        realtimeIds: new Set<string>(),
        fetched: [arrived],
        hasMore: true,
        serverUnreadCount: 0,
        serverNeedsActionCount: 0,
        serverMentionsCount: 0,
        view: "all",
      },
    );

    expect(state.notifications.map((one) => one.id)).toEqual(["arrived"]);
  });
});

describe("notificationReducer mentions count", () => {
  function createMention(
    overrides: Partial<NotificationItem> = {},
  ): NotificationItem {
    return createNotification({
      id: "notification-mention",
      kind: "CHAT",
      referenceId: "room-1",
      messageKey: "Notifications.Chat.mentioned",
      ...overrides,
    });
  }

  it("takes Core's number on a fetch", () => {
    const afterFetch = notificationReducer(
      {
        notifications: [],
        unreadCount: 0,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      {
        type: "fetch_success",
        realtimeIds: new Set(),
        fetched: [],
        hasMore: false,
        serverUnreadCount: 4,
        serverNeedsActionCount: 0,
        serverMentionsCount: 3,
        view: "mentions",
      },
    );

    expect(afterFetch.mentionsCount).toBe(3);
  });

  it("drops when the reader opens an unread mention", () => {
    const mention = createMention();

    const afterRead = notificationReducer(
      {
        notifications: [mention],
        unreadCount: 1,
        needsActionCount: 0,
        mentionsCount: 1,
      },
      { type: "mark_read_optimistic", id: mention.id },
    );

    expect(afterRead.mentionsCount).toBe(0);
  });

  it("stays when the reader opens a row that is not a mention", () => {
    const job = createNotification();

    const afterRead = notificationReducer(
      {
        notifications: [job],
        unreadCount: 1,
        needsActionCount: 0,
        mentionsCount: 2,
      },
      { type: "mark_read_optimistic", id: job.id },
    );

    expect(afterRead.mentionsCount).toBe(2);
  });

  it("comes back when a mention is marked unread", () => {
    const mention = createMention({ isRead: true, readAt: new Date() });

    const afterUnread = notificationReducer(
      {
        notifications: [mention],
        unreadCount: 0,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      { type: "mark_unread_optimistic", id: mention.id },
    );

    expect(afterUnread.mentionsCount).toBe(1);
  });

  it("rises when a new mention arrives", () => {
    const afterRealtime = notificationReducer(
      {
        notifications: [],
        unreadCount: 0,
        needsActionCount: 0,
        mentionsCount: 0,
      },
      { type: "realtime", notification: createMention(), created: true },
    );

    expect(afterRealtime.mentionsCount).toBe(1);
  });

  it("drops when a held mention comes back read from elsewhere", () => {
    const mention = createMention();

    const afterRealtime = notificationReducer(
      {
        notifications: [mention],
        unreadCount: 1,
        needsActionCount: 0,
        mentionsCount: 1,
      },
      {
        type: "realtime",
        notification: { ...mention, isRead: true, readAt: new Date() },
        created: false,
      },
    );

    expect(afterRealtime.mentionsCount).toBe(0);
  });

  it("clears on mark all read", () => {
    const afterAll = notificationReducer(
      {
        notifications: [createMention()],
        unreadCount: 5,
        needsActionCount: 0,
        mentionsCount: 3,
      },
      { type: "mark_all_read" },
    );

    expect(afterAll.mentionsCount).toBe(0);
  });
});

describe("notificationReducer mentions count reconciliation", () => {
  it("takes Core's number when only a row that is not a mention changed during the fetch", () => {
    const job = createNotification({ isRead: true, readAt: new Date() });

    const afterFetch = notificationReducer(
      {
        notifications: [job],
        unreadCount: 0,
        needsActionCount: 0,
        mentionsCount: 2,
      },
      {
        type: "fetch_success",
        realtimeIds: new Set([job.id]),
        fetched: [{ ...job, isRead: false, readAt: null }],
        hasMore: false,
        serverUnreadCount: 1,
        serverNeedsActionCount: 0,
        serverMentionsCount: 0,
        view: "all",
      },
    );

    expect(afterFetch.mentionsCount).toBe(0);
  });
});
