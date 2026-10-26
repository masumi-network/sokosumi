"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  clearPushDeviceSnapshot,
  refreshPushDevices,
} from "@/queries/push-devices";

import { resumePushPreferenceForSession } from "./push-preference.client";
import { healPushSubscription } from "./push-self-heal.client";
import { forgetUnfinishedPushTeardown } from "./release-push-device.client";

const PUSH_RECOVERY_SUCCESS_THROTTLE_MS = 60_000;
const PUSH_RECOVERY_FAILURE_THROTTLE_MS = 5_000;
/**
 * A repair that succeeded this recently in this tab and session is not
 * repeated on a reload: each repair re-authorizes a push client, a Core token
 * mint, and full page loads were paying for one every time.
 */
const PUSH_RECOVERY_RELOAD_THROTTLE_MS = 10 * 60_000;
const PUSH_RECOVERY_STAMP_KEY = "push-recovery-ok";

function readRecoveryStamp(key: string): number | null {
  try {
    const value = Number(window.sessionStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeRecoveryStamp(key: string, succeeded: boolean): void {
  try {
    if (succeeded) window.sessionStorage.setItem(key, String(Date.now()));
    else window.sessionStorage.removeItem(key);
  } catch {}
}

/** SOK-1120: returning to the app retries repair without overlapping work. */
export function usePushRecovery(
  userId: string,
  sessionId?: string,
  sessionCreatedAt?: number,
): void {
  const queryClient = useQueryClient();
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
    const stampKey = `${PUSH_RECOVERY_STAMP_KEY}:${userId}:${sessionId ?? ""}`;
    const stamp = readRecoveryStamp(stampKey);
    const recentlyRepaired =
      stamp !== null && Date.now() - stamp < PUSH_RECOVERY_RELOAD_THROTTLE_MS;
    // A repair from before this reload counts as the last attempt, so the
    // mount read below waits out the success throttle instead of repeating it.
    let lastAttemptAt: number | null = recentlyRepaired ? Date.now() : null;
    let lastAttemptSucceeded = recentlyRepaired;

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
        if (!disposed) {
          if (lastAttemptSucceeded)
            await clearPushDeviceSnapshot(queryClient, userId);
          void refreshPushDevices(queryClient, userId);
        }
      } catch (error) {
        console.error("Failed to recover push notifications", error);
      } finally {
        writeRecoveryStamp(stampKey, lastAttemptSucceeded);
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
  }, [queryClient, userId, sessionId, sessionCreatedAt]);
}
