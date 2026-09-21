"use client";

import { isNeedsActionNotification } from "@sokosumi/utils";
import { ChannelProvider } from "ably/react";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { NotificationToastListener } from "@/app/components/notification-toast-listener";
import { NotificationUrlTargetOpener } from "@/app/components/notification-url-target-opener";
import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { makeCurrentUserNotificationsChannelName } from "@/lib/ably/current-notifications-channel.client";
import { healPushSubscription } from "@/lib/ably/push-self-heal.client";
import type { NotificationEventData } from "@/lib/ably/schema";
import { useNotificationFrontPresence } from "@/lib/ably/use-notification-front-presence";
import { useNotificationRealtime } from "@/lib/ably/use-notification-realtime";
import { notificationsBrowserClient } from "@/lib/clients/core.notifications.browser.client";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import type {
  GetNotificationsData,
  NotificationItem,
} from "@/lib/clients/generated/core";
import { NOTIFICATION_TOASTER_ID } from "@/lib/constants/notification-toaster";
import { createNotificationReadQueue } from "./notification-read-queue";
import {
  NOTIFICATION_PAGE_SIZE,
  type NotificationAction,
  type NotificationCenterView,
  type NotificationState,
  notificationReducer,
} from "./notification-state";
import {
  getNotificationViewPreference,
  setNotificationViewPreference,
} from "./notification-view-storage";

/**
 * Where the next page of older rows stands.
 *
 * `failed` is a stop, not a retry loop: the boundary row keeps the failure on
 * screen and waits for the reader rather than asking the server again.
 */
export type NotificationOlderStatus = "idle" | "loading" | "failed";

/**
 * Whether Core refused a page because the row it starts from is not in the
 * feed any more. The limit is fixed, so the cursor is the only thing in an
 * older-page request that can be bad.
 */
function isRejectedCursor(error: unknown): boolean {
  return error instanceof CoreApiRequestError && error.status === 400;
}

/**
 * The list request for a view: the Unread view asks Core for unread rows
 * only, reusing the list's existing read-status filter. The page size never
 * changes; the cursor only pages older.
 */
function buildListQuery(
  view: NotificationCenterView,
  cursor?: string,
): GetNotificationsData["query"] {
  return {
    limit: NOTIFICATION_PAGE_SIZE,
    ...(cursor === undefined ? {} : { cursor }),
    ...(view === "unread" ? { isRead: "false" as const } : {}),
    ...(view === "needs-action" ? { needsAction: "true" as const } : {}),
  };
}

function dismissNotificationToast(notificationId: string) {
  toast.dismiss(notificationId);
}

function dismissAllNotificationToasts() {
  for (const activeToast of toast.getToasts()) {
    if ("dismiss" in activeToast) {
      continue;
    }

    if (activeToast.toasterId === NOTIFICATION_TOASTER_ID) {
      toast.dismiss(activeToast.id);
    }
  }
}

interface NotificationContextValue {
  notifications: NotificationItem[];
  unreadCount: number;
  /** Rows whose request still waits on the reader, for the Needs you tab. */
  needsActionCount: number;
  /** Which rows the list shows. Both frames read and write the same value. */
  view: NotificationCenterView;
  /** Switch views, restarting the list under the new one. */
  setView: (view: NotificationCenterView) => void;
  markRead: (id: string) => Promise<void>;
  /** Put one row back to unread, the reader's way out of a read they did not mean. */
  markUnread: (id: string) => Promise<void>;
  /** Mark several rows read in one write, for a surface the reader has seen. */
  markAllRead: () => Promise<void>;
  /** Drop a notification from local feed state (e.g. resolved vendor grant). */
  removeNotification: (id: string) => void;
  refetch: () => Promise<void>;
  isLoading: boolean;
  hasFetchError: boolean;
  /** Whether Core holds rows older than the ones loaded here. */
  hasMore: boolean;
  olderStatus: NotificationOlderStatus;
  /** Ask for the page of rows older than the oldest one loaded. */
  loadOlder: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

export function useNotifications() {
  const context = use(NotificationContext);
  if (!context) {
    throw new Error(
      "useNotifications must be used within NotificationProvider",
    );
  }
  return context;
}

/**
 * The notification context when there is one, or null when there is not.
 *
 * For components that only nudge the bell and must not take a page down with
 * them when they render outside the provider. Anything that needs the context
 * to do its job should use `useNotifications` and fail loudly instead.
 */
export function useOptionalNotifications(): NotificationContextValue | null {
  return use(NotificationContext);
}

async function noopAsync(): Promise<void> {}

function noopRemove(_id: string): void {}

function noopSetView(_view: NotificationCenterView): void {}

const NOTIFICATION_FALLBACK_VALUE: NotificationContextValue = {
  notifications: [],
  unreadCount: 0,
  needsActionCount: 0,
  view: "all",
  setView: noopSetView,
  markRead: noopAsync,
  markUnread: noopAsync,
  markAllRead: noopAsync,
  removeNotification: noopRemove,
  refetch: noopAsync,
  isLoading: true,
  hasFetchError: false,
  hasMore: false,
  olderStatus: "idle",
  loadOlder: () => {},
};

interface NotificationFallbackProviderProps {
  children: React.ReactNode;
}

/**
 * Passive context for Instant Nav Suspense fallback chrome.
 * Same shape as NotificationProvider — no REST fetch, no Ably.
 */
export function NotificationFallbackProvider({
  children,
}: NotificationFallbackProviderProps) {
  return (
    <NotificationContext value={NOTIFICATION_FALLBACK_VALUE}>
      {children}
    </NotificationContext>
  );
}

interface NotificationProviderProps {
  userId: string;
  children: React.ReactNode;
}

function NotificationRealtimeBridge({
  userId,
  onNotification,
  onSubscribed,
}: {
  userId: string;
  onNotification: (notification: NotificationEventData) => void;
  onSubscribed: () => void;
}) {
  useNotificationRealtime({
    userId,
    onNotification,
    onError: (error) => {
      console.error("Ably notification error:", error);
    },
  });
  useNotificationFrontPresence(userId);

  useMountEffect(() => {
    onSubscribed();
  });

  return null;
}

/**
 * Immediate path: reducer + REST fetch/mark-read + context + children.
 * Sibling island: LazyAbly → ChannelProvider → realtime bridge + toast listener
 * that dispatch into the same reducer. Children never wait on Ably.
 *
 * One state owner for the whole Notification Center: the header panel and the
 * notifications page render the same rows, in the same order, from here. A
 * second list that fetched for itself would answer the same questions twice
 * and could answer them differently.
 */
export function NotificationProvider({
  userId,
  children,
}: NotificationProviderProps) {
  // A browser that was set up for push and lost its subscription is repaired
  // here, because this is where a signed-in reader arrives however they got
  // in. Asks the reader for nothing and leaves a browser that never turned
  // push on alone.
  //
  // Per reader rather than per mount. AuthenticatedAppFrame keys this
  // provider on session.user.id so a second reader remounts it. The effect
  // still follows userId, because a same-instance swap (tests, a mount
  // without that key) would otherwise repair only the first reader.
  useEffect(() => {
    void healPushSubscription(userId);
  }, [userId]);

  const [state, setState] = useState<NotificationState>({
    notifications: [],
    unreadCount: 0,
    needsActionCount: 0,
  });
  const confirmedState = useRef(state);
  const readQueue = useRef(createNotificationReadQueue());
  const [view, setViewState] = useState<NotificationCenterView>("all");
  // The view the next request asks for. A ref so the fetch callbacks keep
  // their identity across switches: the switch itself starts the refetch.
  const viewRef = useRef<NotificationCenterView>(view);
  // The view the reader last chose, restored before the first fetch below.
  // A seed, not a switch: there is no loaded list to tear down yet, and the
  // ref is what the first request reads, so that request already asks for
  // the remembered view instead of fetching All and replacing it.
  //
  // Before paint, not after, or the strip underlines All for one frame and
  // then jumps. The server's markup and the first client render still agree
  // on "all", so hydration is unaffected; only the commit that follows it
  // carries the remembered view. Same seam, and the same reason, as the
  // chat composer's own restore in RoomOpenLoadingView.
  useLayoutEffect(() => {
    const remembered = getNotificationViewPreference();
    if (remembered === null || remembered === viewRef.current) return;
    viewRef.current = remembered;
    setViewState(remembered);
  }, []);
  const [isLoading, setIsLoading] = useState(true);
  const [hasFetchError, setHasFetchError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [olderStatus, setOlderStatus] =
    useState<NotificationOlderStatus>("idle");
  const olderInFlight = useRef(false);
  // Where to page from when the oldest row loaded cannot say: a page that
  // added nothing leaves that row where it was, and asking from it again
  // would return the same page forever. Core's own cursor always moves on.
  const olderCursorOverride = useRef<string | null>(null);
  const rejectedCursorDropped = useRef(false);
  const fetchGenerationRef = useRef(0);
  const latestFetchGeneration = useRef(0);
  const latestReadGeneration = useRef(0);
  // Bumped when a fetch lands, so an older page that took off before it
  // cannot append under a list that fetch just started over.
  const pagingGeneration = useRef(0);
  const realtimeDuringFetch = useRef(new Set<string>());

  const dispatch = useCallback((action: NotificationAction) => {
    if (
      action.type === "mark_read_optimistic" ||
      action.type === "mark_unread_optimistic" ||
      action.type === "mark_all_read"
    ) {
      // A fetch started before this intent cannot restore its old read state.
      latestReadGeneration.current = ++fetchGenerationRef.current;
      setIsLoading(false);
    }
    confirmedState.current = notificationReducer(
      confirmedState.current,
      action,
    );
    setState(confirmedState.current);
  }, []);

  const fetchNotifications = useCallback(async (): Promise<void> => {
    const generation = ++fetchGenerationRef.current;
    latestFetchGeneration.current = generation;
    await readQueue.current.whenIdle();
    if (generation !== fetchGenerationRef.current) {
      if (
        latestFetchGeneration.current === generation &&
        latestReadGeneration.current === fetchGenerationRef.current
      )
        void fetchNotifications();
      return;
    }
    const realtimeIds = new Set<string>();
    realtimeDuringFetch.current = realtimeIds;
    setIsLoading(true);
    const view = viewRef.current;
    const listQuery = buildListQuery(view);

    try {
      const [listResponse, countsResponse] = await Promise.all([
        notificationsBrowserClient.getNotifications(listQuery),
        notificationsBrowserClient.getNotificationsCounts(),
      ]);

      if (generation !== fetchGenerationRef.current) {
        if (
          latestFetchGeneration.current === generation &&
          latestReadGeneration.current === fetchGenerationRef.current
        )
          void fetchNotifications();
        return;
      }

      const readStateChanged = confirmedState.current.notifications.some(
        (notification) =>
          realtimeIds.has(notification.id) &&
          listResponse.data.some(
            (row) =>
              row.id === notification.id && row.isRead !== notification.isRead,
          ),
      );
      const nextCursor = listResponse.meta.pagination.nextCursor;
      dispatch({
        type: "fetch_success",
        fetched: listResponse.data,
        serverUnreadCount: countsResponse.data.unread,
        serverNeedsActionCount: countsResponse.data.needsAction,
        realtimeIds,
        hasMore: nextCursor !== null,
        view,
      });
      pagingGeneration.current += 1;
      // A refresh reads the newest page only. When it reports nothing after
      // it, the feed ends inside that page and the rows below went with it;
      // otherwise there is more to reach, whether or not the reader has
      // already paged past this point.
      setHasMore(nextCursor !== null);
      olderCursorOverride.current = null;
      // A failed older page waits for the reader, whatever a refresh finds.
      // Only a feed that now ends inside the first page makes it moot. An
      // older page still in the air keeps its loading state until it lands
      // and is dropped: going idle now would re-arm the boundary while that
      // request still blocks a new one, and the boundary would not arm again.
      if (nextCursor === null) setOlderStatus("idle");
      setHasFetchError(false);
      if (readStateChanged) void fetchNotifications();
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
      if (generation === fetchGenerationRef.current) {
        setHasFetchError(true);
      }
    } finally {
      if (generation === fetchGenerationRef.current) {
        setIsLoading(false);
      }
    }
  }, [dispatch]);

  /**
   * Switch the list between views. The rows loaded under one view
   * speak for ranges the other never asked for, so the switch drops them,
   * the older-page cursor, and anything in flight, and reads the first page
   * of the new view. It never marks anything read.
   */
  const setView = useCallback(
    (next: NotificationCenterView) => {
      if (viewRef.current === next) return;
      viewRef.current = next;
      setViewState(next);
      setNotificationViewPreference(next);
      // A page in flight answers for the old view. Bumping both generations
      // drops its result when it lands, like a refresh that started over.
      fetchGenerationRef.current += 1;
      pagingGeneration.current += 1;
      dispatch({ type: "reset_list" });
      olderCursorOverride.current = null;
      rejectedCursorDropped.current = false;
      setHasMore(false);
      setOlderStatus("idle");
      setHasFetchError(false);
      setIsLoading(true);
      void fetchNotifications();
    },
    [dispatch, fetchNotifications],
  );

  const loadOlder = useCallback(() => {
    if (olderInFlight.current) return;
    // Unread + a 0 badge: collapsing rows can expose the older-page sentinel
    // while hasMore is still true. The badge already says there is nothing left.
    if (
      viewRef.current === "unread" &&
      confirmedState.current.unreadCount === 0
    ) {
      return;
    }
    const oldest = confirmedState.current.notifications.at(-1);
    const cursor = olderCursorOverride.current ?? oldest?.id;
    if (!cursor) return;

    olderInFlight.current = true;
    setOlderStatus("loading");
    const generation = pagingGeneration.current;
    const listQuery = buildListQuery(viewRef.current, cursor);

    void (async () => {
      try {
        const response =
          await notificationsBrowserClient.getNotifications(listQuery);
        if (generation !== pagingGeneration.current) {
          // The list this page was fetched for started over while it was in
          // the air: more than a page of newer rows arrived, and applying
          // these rows under the new first page would leave the ones
          // between them out for good. The refresh already said whether
          // there is more.
          setOlderStatus("idle");
          return;
        }
        dispatch({ type: "load_older_success", fetched: response.data });
        const nextCursor = response.meta.pagination.nextCursor;
        const movedOn =
          confirmedState.current.notifications.at(-1)?.id !== oldest?.id;
        olderCursorOverride.current = movedOn ? null : nextCursor;
        rejectedCursorDropped.current = false;
        setHasMore(nextCursor !== null);
        setOlderStatus("idle");
      } catch (error) {
        if (generation !== pagingGeneration.current) {
          setOlderStatus("idle");
          return;
        }
        console.error("Failed to load older notifications:", error);
        olderCursorOverride.current = null;
        if (isRejectedCursor(error) && !rejectedCursorDropped.current) {
          // The row the page started from has left the feed, which is how a
          // request resolved in another tab goes. Drop it here too and page
          // from the row above it. Once per attempt: a second refusal in a
          // row waits for the reader, because draining the list one request
          // at a time would be worse than asking.
          rejectedCursorDropped.current = true;
          dispatch({ type: "remove", id: cursor });
          setOlderStatus("idle");
        } else {
          // Only the reader starts a load from here, and their retry may
          // drop one more refused row.
          rejectedCursorDropped.current = false;
          setOlderStatus("failed");
        }
      } finally {
        olderInFlight.current = false;
      }
    })();
  }, [dispatch]);

  const markAllRead = useCallback(async () => {
    // Paint read state immediately so mark-all-read clicks stay within good INP.
    dispatch({ type: "mark_all_read" });
    dismissAllNotificationToasts();

    try {
      await readQueue.current.enqueue(null, () =>
        notificationsBrowserClient.patchNotificationsReadAll(),
      );
    } catch (error) {
      console.error("Failed to mark all notifications as read:", error);
      void fetchNotifications();
      throw error;
    }
  }, [dispatch, fetchNotifications]);

  const markRead = useCallback(
    async (id: string) => {
      const wasUnread = confirmedState.current.notifications.some(
        (row) => row.id === id && !row.isRead,
      );
      // Optimistic update paints before the network round-trip, which keeps
      // notification clicks from blocking Interaction to Next Paint.
      dispatch({ type: "mark_read_optimistic", id });
      dismissNotificationToast(id);

      try {
        await readQueue.current.enqueue([id], async (isCurrent) => {
          const response = await notificationsBrowserClient
            .patchNotificationRead({ id })
            .catch((error: unknown) => {
              // Back to the state the reader can see is true. The refetch
              // below reconciles when Core is reachable; offline, this is
              // the only thing that undoes the optimistic read.
              if (wasUnread && isCurrent(id))
                dispatch({ type: "mark_unread_optimistic", id });
              throw error;
            });

          if (!isCurrent(id)) return;
          dispatch({
            type: "mark_read_success",
            id,
            updated: response.data,
          });
        });
      } catch (error) {
        console.error("Failed to mark notification as read:", error);
        void fetchNotifications();
        throw error;
      }
    },
    [dispatch, fetchNotifications],
  );

  const markUnread = useCallback(
    async (id: string) => {
      const wasRead = confirmedState.current.notifications.some(
        (row) => row.id === id && row.isRead,
      );
      // Optimistic, like the read path, so the row and the badge answer the
      // click before the round-trip.
      dispatch({ type: "mark_unread_optimistic", id });

      try {
        await readQueue.current.enqueue([id], async (isCurrent) => {
          const response = await notificationsBrowserClient
            .patchNotificationUnread({ id })
            .catch((error: unknown) => {
              if (wasRead && isCurrent(id))
                dispatch({ type: "mark_read_optimistic", id });
              throw error;
            });

          if (!isCurrent(id)) return;
          dispatch({
            type: "mark_unread_success",
            id,
            updated: response.data,
          });
        });
      } catch (error) {
        console.error("Failed to mark notification as unread:", error);
        void fetchNotifications();
        throw error;
      }
    },
    [dispatch, fetchNotifications],
  );

  const removeNotification = useCallback(
    (id: string) => {
      dispatch({ type: "remove", id });
      dismissNotificationToast(id);
    },
    [dispatch],
  );

  const handleNotificationEvent = useCallback(
    (notification: NotificationEventData) => {
      // Silenced in the app by the reader's preference matrix. It still arrives,
      // because an OS banner rides the same event.
      if (!notification.inApp) {
        return;
      }

      // State-only publishes can arrive after a newer local write. Read the
      // current server state instead of replaying that possibly stale snapshot.
      if (
        notification.created === false &&
        confirmedState.current.notifications.some(
          (row) =>
            row.id === notification.id && row.isRead !== notification.isRead,
        )
      ) {
        void fetchNotifications();
        return;
      }
      realtimeDuringFetch.current.add(notification.id);
      dispatch({
        type: "realtime",
        created: notification.created,
        notification: {
          ...notification,
          kind: notification.kind as NotificationItem["kind"],
          readAt: notification.readAt ? new Date(notification.readAt) : null,
          createdAt: new Date(notification.createdAt),
        },
      });

      // A new request for the reader changes the Needs you count, and only
      // Core can say by how much: a task that asked again is still one row.
      // The row is already painted; the fetch brings the number.
      if (
        notification.created &&
        isNeedsActionNotification(notification.messageKey)
      ) {
        void fetchNotifications();
      }
    },
    [dispatch, fetchNotifications],
  );

  const handleRealtimeSubscribed = useCallback(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  const value: NotificationContextValue = {
    notifications: state.notifications,
    unreadCount: state.unreadCount,
    needsActionCount: state.needsActionCount,
    view,
    setView,
    markRead,
    markUnread,
    markAllRead,
    removeNotification,
    refetch: fetchNotifications,
    isLoading,
    hasFetchError,
    hasMore,
    olderStatus,
    loadOlder,
  };

  return (
    <NotificationContext value={value}>
      {children}
      {/* Outside the lazy provider: a window the push worker opened carries
          its target on the URL, and spending that must not wait on the Ably
          chunk or on a client that will not start. */}
      <NotificationUrlTargetOpener markRead={markRead} />
      <LazyAblyProvider>
        <ChannelProvider
          channelName={makeCurrentUserNotificationsChannelName(userId)}
        >
          <NotificationRealtimeBridge
            userId={userId}
            onNotification={handleNotificationEvent}
            onSubscribed={handleRealtimeSubscribed}
          />
          <NotificationToastListener userId={userId} markRead={markRead} />
        </ChannelProvider>
      </LazyAblyProvider>
    </NotificationContext>
  );
}
