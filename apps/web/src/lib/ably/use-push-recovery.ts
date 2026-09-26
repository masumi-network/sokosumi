"use client";

import { useEffect } from "react";

import { resumePushPreferenceForSession } from "./push-preference.client";
import { healPushSubscription } from "./push-self-heal.client";
import { forgetUnfinishedPushTeardown } from "./release-push-device.client";

const PUSH_RECOVERY_SUCCESS_THROTTLE_MS = 60_000;
const PUSH_RECOVERY_FAILURE_THROTTLE_MS = 5_000;

/** SOK-1120: returning to the app retries repair without overlapping work. */
export function usePushRecovery(
  userId: string,
  sessionId?: string,
  sessionCreatedAt?: number,
): void {
  useEffect(() => {
    if (
      sessionId &&
      sessionCreatedAt !== undefined &&
      resumePushPreferenceForSession(userId, sessionId, sessionCreatedAt)
    ) {
      forgetUnfinishedPushTeardown();
    }
    let disposed = false;
    let inFlight = false;
    let reconnectPending = false;
    let lastAttemptAt: number | null = null;
    let lastAttemptSucceeded = false;

    async function recover(retryFailure = false): Promise<void> {
      if (disposed) return;
      if (inFlight) {
        reconnectPending ||= retryFailure;
        return;
      }
      const throttleMs = lastAttemptSucceeded
        ? PUSH_RECOVERY_SUCCESS_THROTTLE_MS
        : PUSH_RECOVERY_FAILURE_THROTTLE_MS;
      if (
        lastAttemptAt !== null &&
        Date.now() - lastAttemptAt < throttleMs &&
        !(retryFailure && !lastAttemptSucceeded)
      ) {
        return;
      }

      inFlight = true;
      lastAttemptSucceeded = false;
      try {
        lastAttemptSucceeded = await healPushSubscription(userId);
      } catch (error) {
        console.error("Failed to recover push notifications", error);
      } finally {
        lastAttemptAt = Date.now();
        inFlight = false;
        const retryReconnect = reconnectPending && !lastAttemptSucceeded;
        reconnectPending = false;
        if (retryReconnect) void recover(true);
      }
    }

    const onReturn = () => {
      void recover();
    };
    const onOnline = () => {
      void recover(true);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        onReturn();
      }
    };

    onReturn();
    window.addEventListener("focus", onReturn);
    window.addEventListener("pageshow", onReturn);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("pageshow", onReturn);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [userId, sessionId, sessionCreatedAt]);
}
