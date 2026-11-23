"use client";

import { makeUserTasksChannelName } from "@sokosumi/utils";
import { ChannelProvider } from "ably/react";
import { createContext, use } from "react";
import { NotificationToastListener } from "@/app/components/notification-toast-listener";
import { NotificationUrlTargetOpener } from "@/app/components/notification-url-target-opener";
import { NeedsYouTasksRealtimeRefresh } from "@/components/notifications/notification-waiting-tasks";
import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import {
  type NotificationContextValue,
  type NotificationOlderStatus,
  useNotificationFeed,
} from "@/hooks/effects/use-notification-feed";
import { useNotificationFrontPresence } from "@/hooks/effects/use-notification-front-presence";
import { useNotificationRealtime } from "@/hooks/effects/use-notification-realtime";
import { usePushRecovery } from "@/hooks/effects/use-push-recovery";
import { makeCurrentUserNotificationsChannelName } from "@/lib/ably/current-notifications-channel.client";
import { getRealtimeChannelEnvironment } from "@/lib/ably/realtime-channel-environment";
import type { NotificationEventData } from "@/lib/ably/schema";
import type { NotificationCenterView } from "./notification-state";

export type { NotificationOlderStatus };

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
  mentionsCount: 0,
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
  /**
   * The active organization, null in the personal workspace. The Needs you
   * rows and count depend on it, and a workspace switch keeps this provider
   * mounted, so a change reads them again.
   */
  organizationId?: string | null;
  sessionId?: string;
  sessionCreatedAt?: number;
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
    onSubscribed,
    onError: (error) => {
      console.error("Ably notification error:", error);
    },
  });
  useNotificationFrontPresence(userId);

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
  organizationId = null,
  sessionId,
  sessionCreatedAt,
  children,
}: NotificationProviderProps) {
  usePushRecovery(userId, sessionId, sessionCreatedAt);

  const { value, markRead, handleNotificationEvent, handleRealtimeSubscribed } =
    useNotificationFeed(organizationId);

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
        <ChannelProvider
          channelName={makeUserTasksChannelName(
            userId,
            getRealtimeChannelEnvironment(),
          )}
        >
          <NeedsYouTasksRealtimeRefresh userId={userId} />
        </ChannelProvider>
      </LazyAblyProvider>
    </NotificationContext>
  );
}
