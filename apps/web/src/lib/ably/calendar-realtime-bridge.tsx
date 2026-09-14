"use client";

import {
  CALENDAR_ACCESS_REVOKED_EVENT_NAME,
  CALENDAR_INVALIDATED_EVENT_NAME,
  makeUserCalendarControlChannelName,
  makeWorkspaceCalendarChannelName,
} from "@sokosumi/utils";
import type * as Ably from "ably";
import { useAbly } from "ably/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { z } from "zod";

import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import { clearCalendarIdentityLabelCacheForWorkspace } from "@/lib/schedules/calendar-identity-label-cache";

import {
  isExpectedAblyChannelLifecycleError,
  safeDetachChannel,
} from "./safe-detach-channel";
import { useAblyConnectionHealthPublisher } from "./use-ably-connection-health-publisher";

const calendarInvalidationEventSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().nullable(),
  calendarRevision: z.number().int().nonnegative(),
  payload: z.unknown(),
});

const calendarAccessRevokedEventSchema = z.object({
  workspaceId: z.string().min(1),
  organizationId: z.string().min(1),
  at: z.string().datetime(),
});

const CALENDAR_REFRESH_COALESCE_MS = 50;
const CALENDAR_AUTH_RETRY_MS = 5_000;

function hasSubscribeCapability(
  capability: unknown,
  channelName: string,
): boolean | null {
  let capabilityMap: Record<string, unknown>;
  if (capability == null) {
    return null;
  }
  if (typeof capability === "string") {
    try {
      const parsed: unknown = JSON.parse(capability);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      capabilityMap = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof capability === "object" && !Array.isArray(capability)) {
    capabilityMap = capability as Record<string, unknown>;
  } else {
    return null;
  }

  const operations = capabilityMap[channelName];
  return Array.isArray(operations) && operations.includes("subscribe");
}

interface CalendarRealtimeBridgeProps {
  currentUserId: string;
  workspaceId: string;
  onAccessRevoked: () => void;
  onResync: () => void;
}

function CalendarRealtimeSubscription({
  currentUserId,
  workspaceId,
  onAccessRevoked,
  onResync,
}: CalendarRealtimeBridgeProps) {
  const ably = useAbly();
  const router = useRouter();
  useAblyConnectionHealthPublisher();
  const onAccessRevokedRef = useRef(onAccessRevoked);
  onAccessRevokedRef.current = onAccessRevoked;
  const onResyncRef = useRef(onResync);
  onResyncRef.current = onResync;

  useEffect(() => {
    let cancelled = false;
    let revoked = false;
    let calendarSubscribed = false;
    let controlSubscribed = false;
    let syncGeneration = 0;
    let refreshTimeout: ReturnType<typeof setTimeout> | undefined;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;
    const calendarChannelName = makeWorkspaceCalendarChannelName(
      workspaceId,
      currentUserId,
    );
    const calendarChannel = ably.channels.get(calendarChannelName);
    const controlChannel = ably.channels.get(
      makeUserCalendarControlChannelName(currentUserId),
    );

    function handleInvalidated(message: Ably.Message) {
      const parsed = calendarInvalidationEventSchema.safeParse(message.data);
      if (
        !parsed.success ||
        parsed.data.workspaceId !== workspaceId ||
        revoked
      ) {
        if (!parsed.success) {
          console.error(
            "Failed to parse calendar_invalidated event",
            message,
            parsed.error,
          );
        }
        return;
      }

      clearCalendarIdentityLabelCacheForWorkspace(workspaceId);
      if (!refreshTimeout) {
        refreshTimeout = setTimeout(() => {
          refreshTimeout = undefined;
          router.refresh();
        }, CALENDAR_REFRESH_COALESCE_MS);
      }
    }

    function detachCalendar() {
      if (!calendarSubscribed) {
        return;
      }
      calendarChannel.unsubscribe(
        CALENDAR_INVALIDATED_EVENT_NAME,
        handleInvalidated,
      );
      safeDetachChannel(calendarChannel);
      calendarSubscribed = false;
    }

    function revokeActiveWorkspace() {
      if (revoked) {
        return;
      }
      revoked = true;
      syncGeneration += 1;
      clearTimeout(refreshTimeout);
      refreshTimeout = undefined;
      detachCalendar();
      clearCalendarIdentityLabelCacheForWorkspace(workspaceId);
      onAccessRevokedRef.current();
      router.replace("/");
      router.refresh();
    }

    function scheduleSyncRetry(
      generation: number,
      error: unknown,
      message: string,
    ) {
      if (!cancelled && !revoked && generation === syncGeneration) {
        retryTimeout = setTimeout(() => {
          void syncAccess(true);
        }, CALENDAR_AUTH_RETRY_MS);
        if (!isExpectedAblyChannelLifecycleError(error)) {
          console.error(message, error);
        }
      }
    }

    async function syncAccess(resync: boolean) {
      clearTimeout(retryTimeout);
      const generation = ++syncGeneration;
      try {
        if (controlSubscribed) {
          await controlChannel.attach();
        } else {
          const subscription = controlChannel.subscribe(
            CALENDAR_ACCESS_REVOKED_EVENT_NAME,
            handleAccessRevoked,
          );
          controlSubscribed = true;
          await subscription;
        }
      } catch (error) {
        scheduleSyncRetry(
          generation,
          error,
          "Failed to attach Ably Calendar control channel",
        );
        return;
      }
      if (cancelled || revoked || generation !== syncGeneration) {
        return;
      }

      let tokenDetails: Ably.TokenDetails;
      try {
        tokenDetails = await ably.auth.authorize();
      } catch (error) {
        if (!cancelled && !revoked && generation === syncGeneration) {
          retryTimeout = setTimeout(() => {
            void syncAccess(true);
          }, CALENDAR_AUTH_RETRY_MS);
          console.error("Failed to authorize Ably for Calendar", error);
        }
        return;
      }
      if (cancelled || revoked || generation !== syncGeneration) {
        return;
      }

      if (
        hasSubscribeCapability(tokenDetails.capability, calendarChannelName) ===
        false
      ) {
        revokeActiveWorkspace();
        return;
      }

      if (!calendarSubscribed) {
        try {
          const subscription = calendarChannel.subscribe(
            CALENDAR_INVALIDATED_EVENT_NAME,
            handleInvalidated,
          );
          calendarSubscribed = true;
          await subscription;
        } catch (error) {
          scheduleSyncRetry(
            generation,
            error,
            "Failed to attach Ably Calendar workspace channel",
          );
          return;
        }
      } else {
        try {
          await calendarChannel.attach();
        } catch (error) {
          scheduleSyncRetry(
            generation,
            error,
            "Failed to attach Ably Calendar workspace channel",
          );
          return;
        }
      }
      if (cancelled || revoked || generation !== syncGeneration) {
        return;
      }
      if (resync) {
        clearCalendarIdentityLabelCacheForWorkspace(workspaceId);
        onResyncRef.current();
        router.refresh();
      }
    }

    function handleAccessRevoked(message: Ably.Message) {
      const parsed = calendarAccessRevokedEventSchema.safeParse(message.data);
      if (!parsed.success || revoked) {
        if (!parsed.success) {
          console.error(
            "Failed to parse calendar_access_revoked event",
            message,
            parsed.error,
          );
        }
        return;
      }

      if (parsed.data.workspaceId !== workspaceId) {
        clearCalendarIdentityLabelCacheForWorkspace(parsed.data.workspaceId);
        void syncAccess(false);
        return;
      }

      // A control message can arrive after this user has already rejoined.
      // Refresh capability first; only a token that still lacks the exact
      // workspace channel is authoritative enough to evict local state.
      void syncAccess(true);
    }

    // The server snapshot can become stale between render and subscription.
    // Refresh once after the initial capability check closes that mount gap.
    void syncAccess(true);

    const handleRecovery = () => {
      void syncAccess(true);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        handleRecovery();
      }
    };

    window.addEventListener("focus", handleRecovery);
    window.addEventListener("online", handleRecovery);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    ably.connection.on("connected", handleRecovery);

    return () => {
      cancelled = true;
      revoked = true;
      syncGeneration += 1;
      clearTimeout(refreshTimeout);
      clearTimeout(retryTimeout);
      window.removeEventListener("focus", handleRecovery);
      window.removeEventListener("online", handleRecovery);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      ably.connection.off("connected", handleRecovery);
      detachCalendar();
      controlChannel.unsubscribe(
        CALENDAR_ACCESS_REVOKED_EVENT_NAME,
        handleAccessRevoked,
      );
      safeDetachChannel(controlChannel);
    };
  }, [ably, currentUserId, router, workspaceId]);

  return null;
}

export function CalendarRealtimeBridge(props: CalendarRealtimeBridgeProps) {
  return (
    <LazyAblyProvider>
      <CalendarRealtimeSubscription {...props} />
    </LazyAblyProvider>
  );
}
