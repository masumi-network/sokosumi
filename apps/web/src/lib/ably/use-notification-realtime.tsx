"use client";

import type * as Ably from "ably";
import { useChannel } from "ably/react";
import { useCallback } from "react";

import {
  makeUserNotificationsChannelName,
  type NotificationEventData,
  notificationEventDataSchema,
} from "@/lib/ably";

const NOTIFICATION_CREATED_EVENT_NAME = "notification_created";

interface UseNotificationRealtimeOptions {
  userId: string;
  onNotification?: (notification: NotificationEventData) => void;
  onError?: (error: Error) => void;
}

export function useNotificationRealtime({
  userId,
  onNotification,
  onError,
}: UseNotificationRealtimeOptions) {
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

  useChannel(
    makeUserNotificationsChannelName(userId),
    NOTIFICATION_CREATED_EVENT_NAME,
    handleMessage,
  );
}
