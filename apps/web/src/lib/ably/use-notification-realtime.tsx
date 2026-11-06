"use client";

import type * as Ably from "ably";
import { useAbly, useChannel } from "ably/react";
import { useCallback, useEffect, useEffectEvent } from "react";

import {
  type NotificationEventData,
  notificationEventDataSchema,
} from "@/lib/ably/schema";
import { makeCurrentUserNotificationsChannelName } from "./current-notifications-channel.client";

const NOTIFICATION_CREATED_EVENT_NAME = "notification_created";

interface UseNotificationRealtimeOptions {
  userId: string;
  onNotification?: (notification: NotificationEventData) => void;
  onSubscribed?: () => void;
  onError?: (error: Error) => void;
}

export function useNotificationRealtime({
  userId,
  onNotification,
  onSubscribed,
  onError,
}: UseNotificationRealtimeOptions) {
  const client = useAbly();
  const handleMessage = useCallback(
    (message: Ably.Message) => {
      const parsedResult = notificationEventDataSchema.safeParse(message.data);
      if (!parsedResult.success) {
        const error = new Error(
          `Failed to parse NotificationEventData from message: ${parsedResult.error.message}`,
        );
        console.error(error, message, parsedResult.error);
        onError?.(error);
        return;
      }

      onNotification?.(parsedResult.data);
    },
    [onNotification, onError],
  );

  const { channel } = useChannel(
    makeCurrentUserNotificationsChannelName(userId),
    NOTIFICATION_CREATED_EVENT_NAME,
    handleMessage,
  );

  const handleSubscribed = useEffectEvent(() => onSubscribed?.());

  useEffect(() => {
    function handleAttached() {
      handleSubscribed();
    }

    function handleUpdate(change: Ably.ChannelStateChange) {
      if (!change.resumed) handleSubscribed();
    }

    channel.on("attached", handleAttached);
    channel.on("update", handleUpdate);
    // The REST snapshot can precede attachment, and a non-resumed attach
    // cannot replay everything the reader missed while disconnected.
    if (channel.state === "attached") handleSubscribed();

    return () => {
      channel.off("attached", handleAttached);
      channel.off("update", handleUpdate);
    };
  }, [channel]);

  return {
    /**
     * Whether this page is receiving notifications at the moment it is asked.
     * A detached channel means the app shows nothing for the notification,
     * however much of the app is on screen.
     */
    isReceivingNotifications: () =>
      client.connection.state === "connected" && channel.state === "attached",
  };
}
