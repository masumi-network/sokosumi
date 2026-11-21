"use client";

import { useEffect, useEffectEvent } from "react";

import { getBrowserNotificationPermission } from "@/lib/utils/browser-notification";
import {
  answerShowsNotificationsQuery,
  getNotificationServiceWorker,
  type NotificationTarget,
  subscribeNotificationClicks,
} from "@/lib/utils/notification-service-worker";

interface UseNotificationServiceWorkerBridgeOptions {
  onNotificationClick: (target: NotificationTarget) => void;
  isReceivingNotifications: () => boolean;
}

/**
 * Installs the notification service worker on mount when permission is granted,
 * routes service-worker notification clicks to `onNotificationClick`, and
 * answers worker queries about whether this tab is actively showing banners.
 */
export function useNotificationServiceWorkerBridge({
  onNotificationClick,
  isReceivingNotifications,
}: UseNotificationServiceWorkerBridgeOptions): void {
  const openClickedNotification = useEffectEvent(onNotificationClick);
  const showsNotifications = useEffectEvent(isReceivingNotifications);

  // Install the worker ahead of the first banner. A reader who never turns
  // push on still renders through it, so waiting for an install at banner time
  // would cost them the banner's timing.
  useEffect(() => {
    if (getBrowserNotificationPermission() === "granted") {
      void getNotificationServiceWorker();
    }

    const unsubscribeClicks = subscribeNotificationClicks((target) => {
      openClickedNotification(target);
    });
    const stopAnswering = answerShowsNotificationsQuery(() =>
      showsNotifications(),
    );

    return () => {
      unsubscribeClicks();
      stopAnswering();
    };
  }, []);
}
