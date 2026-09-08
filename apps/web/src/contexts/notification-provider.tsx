"use client";

import { ChannelProvider } from "ably/react";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { NotificationToastListener } from "@/app/components/notification-toast-listener";
import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import { useMountEffect } from "@/hooks/use-mount-effect";
import type { NotificationEventData } from "@/lib/ably";
import { makeCurrentUserNotificationsChannelName } from "@/lib/ably/current-notifications-channel.client";
import { useNotificationRealtime } from "@/lib/ably/use-notification-realtime";
import { notificationsBrowserClient } from "@/lib/clients/core.notifications.browser.client";
import type { NotificationItem } from "@/lib/clients/generated/core";
import { NOTIFICATION_TOASTER_ID } from "@/lib/constants/notification-toaster";
import {
  NOTIFICATION_LIST_LIMIT,
  type NotificationAction,
  type NotificationState,
  notificationReducer,
} from "./notification-state";

export type NotificationDeletionEvent = {
  operationId: number;
  phase: "start" | "success" | "failure";
} & ({ kind: "delete"; id: string } | { kind: "clear" });

type NotificationDeletionListener = (event: NotificationDeletionEvent) => void;

interface PendingDeletion {
  event: NotificationDeletionEvent;
  coveredByClear?: boolean;
  initialIds?: Set<string>;
  createdIds?: Set<string>;
  newerState?: NotificationState;
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
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  /** Delete one notification for good, in Core and in local feed state. */
  deleteNotification: (id: string) => Promise<void>;
  /** Delete every notification-center row for good, in Core and locally. */
  clearNotifications: () => Promise<void>;
  subscribeToDeletion: (listener: NotificationDeletionListener) => () => void;
  /** Drop a notification from local feed state (e.g. resolved vendor grant). */
  removeNotification: (id: string) => void;
  refetch: () => Promise<void>;
  isLoading: boolean;
  hasFetchError: boolean;
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

async function noopAsync(): Promise<void> {}

function noopRemove(_id: string): void {}

const NOTIFICATION_FALLBACK_VALUE: NotificationContextValue = {
  notifications: [],
  unreadCount: 0,
  markRead: noopAsync,
  markAllRead: noopAsync,
  deleteNotification: noopAsync,
  clearNotifications: noopAsync,
  subscribeToDeletion: () => () => {},
  removeNotification: noopRemove,
  refetch: noopAsync,
  isLoading: true,
  hasFetchError: false,
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

  useMountEffect(() => {
    onSubscribed();
  });

  return null;
}

/**
 * Immediate path: reducer + REST fetch/mark-read + context + children.
 * Sibling island: LazyAbly → ChannelProvider → realtime bridge + toast listener
 * that dispatch into the same reducer. Children never wait on Ably.
 */
export function NotificationProvider({
  userId,
  children,
}: NotificationProviderProps) {
  const [state, setState] = useState<NotificationState>({
    notifications: [],
    unreadCount: 0,
  });
  const confirmedState = useRef(state);
  const pendingDeletions = useRef(new Map<number, PendingDeletion>());
  const deletionListeners = useRef(new Set<NotificationDeletionListener>());
  const nextDeletionId = useRef(0);
  const deletedIds = useRef(new Set<string>());
  const [isLoading, setIsLoading] = useState(true);
  const [hasFetchError, setHasFetchError] = useState(false);
  const fetchGenerationRef = useRef(0);
  const realtimeDuringFetch = useRef(new Set<string>());
  const refreshAfterDeletion = useRef(false);

  const publishState = useCallback(() => {
    let visible =
      [...pendingDeletions.current.values()].find(
        (pending) => pending.event.kind === "clear",
      )?.newerState ?? confirmedState.current;
    for (const { event } of pendingDeletions.current.values()) {
      if (event.kind === "delete")
        visible = notificationReducer(visible, {
          type: "remove",
          id: event.id,
        });
    }
    setState(visible);
  }, []);

  const dispatch = useCallback(
    (action: NotificationAction) => {
      confirmedState.current = notificationReducer(
        confirmedState.current,
        action,
      );
      for (const pending of pendingDeletions.current.values()) {
        if (!pending.newerState || !pending.createdIds) continue;
        if (action.type === "realtime") {
          if (
            action.created &&
            !pending.initialIds?.has(action.notification.id)
          )
            pending.createdIds.add(action.notification.id);
          if (!pending.createdIds.has(action.notification.id)) continue;
        }
        if (
          (action.type === "mark_read_success" ||
            action.type === "unread_deleted") &&
          !pending.createdIds.has(action.id)
        )
          continue;
        if (action.type === "fetch_success" || action.type === "clear_all")
          continue;
        pending.newerState = notificationReducer(pending.newerState, action);
      }
      publishState();
    },
    [publishState],
  );

  const subscribeToDeletion = useCallback(
    (listener: NotificationDeletionListener) => {
      deletionListeners.current.add(listener);
      for (const pending of pendingDeletions.current.values())
        listener(pending.event);
      return () => {
        deletionListeners.current.delete(listener);
      };
    },
    [],
  );

  const emitDeletion = useCallback(
    (event: NotificationDeletionEvent) => {
      ++fetchGenerationRef.current;
      setIsLoading(false);
      publishState();
      for (const listener of deletionListeners.current) listener(event);
    },
    [publishState],
  );

  const fetchNotifications = useCallback(async (): Promise<void> => {
    if (pendingDeletions.current.size) {
      refreshAfterDeletion.current = true;
      return;
    }
    const realtimeIds = new Set<string>();
    realtimeDuringFetch.current = realtimeIds;
    const generation = ++fetchGenerationRef.current;
    setIsLoading(true);

    try {
      const [listResponse, countResponse] = await Promise.all([
        notificationsBrowserClient.getNotifications({
          limit: NOTIFICATION_LIST_LIMIT,
        }),
        notificationsBrowserClient.getNotificationsUnreadCount(),
      ]);

      if (generation !== fetchGenerationRef.current) {
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
      dispatch({
        type: "fetch_success",
        fetched: listResponse.data,
        serverUnreadCount: countResponse.data.count,
        realtimeIds,
      });
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

  const markAllRead = useCallback(async () => {
    // Paint read state immediately so mark-all-read clicks stay within good INP.
    dispatch({ type: "mark_all_read" });
    dismissAllNotificationToasts();

    try {
      await notificationsBrowserClient.patchNotificationsReadAll();
    } catch (error) {
      console.error("Failed to mark all notifications as read:", error);
      void fetchNotifications();
      throw error;
    }
  }, [dispatch, fetchNotifications]);

  const markRead = useCallback(
    async (id: string) => {
      // Optimistic update paints before the network round-trip, which keeps
      // notification clicks from blocking Interaction to Next Paint.
      dispatch({ type: "mark_read_optimistic", id });
      dismissNotificationToast(id);

      try {
        const response = await notificationsBrowserClient.patchNotificationRead(
          { id },
        );

        if (deletedIds.current.has(id)) return;
        dispatch({
          type: "mark_read_success",
          id,
          updated: response.data,
        });
      } catch (error) {
        console.error("Failed to mark notification as read:", error);
        void fetchNotifications();
        throw error;
      }
    },
    [dispatch, fetchNotifications],
  );

  const deleteNotification = useCallback(
    async (id: string) => {
      if (
        [...pendingDeletions.current.values()].some(
          ({ event }) => event.kind === "delete" && event.id === id,
        )
      )
        return;
      const event: NotificationDeletionEvent = {
        operationId: ++nextDeletionId.current,
        phase: "start",
        kind: "delete",
        id,
      };
      const pending: PendingDeletion = { event };
      pendingDeletions.current.set(event.operationId, pending);
      emitDeletion(event);
      dismissNotificationToast(id);

      try {
        const response = await notificationsBrowserClient.deleteNotification({
          id,
        });
        deletedIds.current.add(id);
        if (!pending.coveredByClear) {
          const held = confirmedState.current.notifications.some(
            (notification) => notification.id === id,
          );
          dispatch({ type: "remove", id });
          if (!held && !response.data.isRead)
            dispatch({ type: "unread_deleted", id });
        }
        pendingDeletions.current.delete(event.operationId);
        emitDeletion({ ...event, phase: "success" });
      } catch (error) {
        pendingDeletions.current.delete(event.operationId);
        emitDeletion({ ...event, phase: "failure" });
        console.error("Failed to delete notification:", error);
        refreshAfterDeletion.current = true;
        throw error;
      } finally {
        if (!pendingDeletions.current.size && refreshAfterDeletion.current) {
          refreshAfterDeletion.current = false;
          void fetchNotifications();
        }
      }
    },
    [dispatch, emitDeletion, fetchNotifications],
  );

  const clearNotifications = useCallback(async () => {
    if (
      [...pendingDeletions.current.values()].some(
        ({ event }) => event.kind === "clear",
      )
    )
      return;
    const event: NotificationDeletionEvent = {
      operationId: ++nextDeletionId.current,
      phase: "start",
      kind: "clear",
    };
    const pendingClear: PendingDeletion = {
      event,
      initialIds: new Set(
        confirmedState.current.notifications.map(
          (notification) => notification.id,
        ),
      ),
      createdIds: new Set(),
      newerState: { notifications: [], unreadCount: 0 },
    };
    pendingDeletions.current.set(event.operationId, pendingClear);
    emitDeletion(event);
    dismissAllNotificationToasts();

    try {
      await notificationsBrowserClient.deleteNotifications();
      for (const id of pendingClear.initialIds ?? [])
        deletedIds.current.add(id);
      for (const pending of pendingDeletions.current.values()) {
        if (
          pending.event.kind === "delete" &&
          !pendingClear.createdIds?.has(pending.event.id)
        )
          pending.coveredByClear = true;
      }
      confirmedState.current = pendingClear.newerState ?? {
        notifications: [],
        unreadCount: 0,
      };
      pendingDeletions.current.delete(event.operationId);
      emitDeletion({ ...event, phase: "success" });
    } catch (error) {
      pendingDeletions.current.delete(event.operationId);
      emitDeletion({ ...event, phase: "failure" });
      console.error("Failed to clear notifications:", error);
      throw error;
    } finally {
      refreshAfterDeletion.current = true;
      if (!pendingDeletions.current.size) {
        refreshAfterDeletion.current = false;
        void fetchNotifications();
      }
    }
  }, [dispatch, emitDeletion, fetchNotifications]);

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
      if (!notification.inApp || deletedIds.current.has(notification.id)) {
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
    },
    [dispatch],
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
    markRead,
    markAllRead,
    deleteNotification,
    clearNotifications,
    subscribeToDeletion,
    removeNotification,
    refetch: fetchNotifications,
    isLoading,
    hasFetchError,
  };

  return (
    <NotificationContext value={value}>
      {children}
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
