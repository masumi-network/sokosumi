"use client";

import {
  type ChatPresenceMemberData,
  makeOrgPresenceChannelName,
} from "@sokosumi/utils";
import type * as Ably from "ably";
import { useAbly } from "ably/react";
import { useEffect, useRef } from "react";

import { organizationIdsFromAblyCapability } from "./organization-ids-from-ably-capability";
import { safeDetachChannel } from "./safe-detach-channel";
import {
  ORG_PRESENCE_PUBLISH_MIN_INTERVAL_MS,
  shouldPublishOrgPresenceUpdate,
} from "./should-publish-org-presence";

const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
] as const;

/** Local recheck only; unchanged payloads still do not publish. */
const PRESENCE_IDLE_TICK_MS = 30_000;

function buildPresenceData(
  lastActiveAt: number,
  visible: boolean,
): ChatPresenceMemberData {
  return { lastActiveAt, visible };
}

/**
 * Enter Ably Presence on every org channel granted on the token (ADR-0003).
 * Updates lastActiveAt / visible from browser activity and visibility.
 * Unchanged idle presence does not publish; activity refreshes lastActiveAt
 * on a ~4 min throttle. A 30s local tick only rechecks; it is not an Ably
 * message. Visibility, enter, and reconnect force publish.
 * Owns channel attach/detach for presence channels (map only subscribes).
 */
export function useOrgPresencePublisher(): void {
  const ably = useAbly();
  const channelsRef = useRef(new Map<string, Ably.RealtimeChannel>());
  const lastActiveAtRef = useRef(Date.now());
  const lastPublishedAtRef = useRef(0);
  const lastPublishedRef = useRef<ChatPresenceMemberData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const channels = channelsRef.current;
    /** Coalesce mount + connected so authorize never overlaps. */
    let syncInFlight = false;
    let syncQueued = false;

    async function publishPresence(force: boolean): Promise<void> {
      if (cancelled) {
        return;
      }
      const visible = !document.hidden;
      const now = Date.now();
      const lastActiveAt = lastActiveAtRef.current;
      const data = buildPresenceData(lastActiveAt, visible);

      const shouldPublish = shouldPublishOrgPresenceUpdate({
        force,
        next: data,
        lastPublished: lastPublishedRef.current,
        lastPublishedAt: lastPublishedAtRef.current,
        now,
        minIntervalMs: ORG_PRESENCE_PUBLISH_MIN_INTERVAL_MS,
      });

      if (!shouldPublish || channels.size === 0) {
        return;
      }

      const results = await Promise.all(
        [...channels.values()].map(async (channel) => {
          if (cancelled) {
            return false;
          }
          try {
            await channel.presence.update(data);
            return true;
          } catch {
            if (cancelled) {
              return false;
            }
            try {
              await channel.presence.enter(data);
              return true;
            } catch (error) {
              if (!cancelled) {
                console.error("Ably presence enter/update failed:", error);
              }
              return false;
            }
          }
        }),
      );

      if (cancelled) {
        return;
      }

      if (results.some(Boolean)) {
        lastPublishedAtRef.current = now;
        lastPublishedRef.current = data;
      }
    }

    async function runSyncOnce(): Promise<void> {
      if (cancelled) {
        return;
      }
      let tokenDetails: Ably.TokenDetails | null = null;
      try {
        tokenDetails = await ably.auth.authorize();
      } catch (error) {
        if (!cancelled) {
          console.error("Ably authorize for presence failed:", error);
        }
        return;
      }
      if (cancelled) {
        return;
      }

      const organizationIds =
        organizationIdsFromAblyCapability(tokenDetails?.capability) ?? [];
      const nextNames = new Set(
        organizationIds.map((id) => makeOrgPresenceChannelName(id)),
      );

      for (const [name, channel] of channels) {
        if (cancelled) {
          return;
        }
        if (!nextNames.has(name)) {
          try {
            await channel.presence.leave();
          } catch {
            // ignore leave errors on detach
          }
          safeDetachChannel(channel);
          channels.delete(name);
        }
      }

      if (cancelled) {
        return;
      }

      // Ensure every granted org channel is tracked, then force enter/update on
      // all of them. Skipping already-tracked channels leaves self offline after
      // hard reconnect (Ably only auto-restores presence on resume).
      for (const name of nextNames) {
        if (!channels.has(name)) {
          channels.set(name, ably.channels.get(name));
        }
      }
      await publishPresence(true);
    }

    async function syncChannels(): Promise<void> {
      if (syncInFlight) {
        syncQueued = true;
        return;
      }
      syncInFlight = true;
      try {
        do {
          syncQueued = false;
          await runSyncOnce();
        } while (syncQueued && !cancelled);
      } finally {
        syncInFlight = false;
      }
    }

    function handleActivity() {
      lastActiveAtRef.current = Date.now();
      void publishPresence(false);
    }

    function handleVisibility() {
      if (!document.hidden) {
        lastActiveAtRef.current = Date.now();
      }
      void publishPresence(true);
    }

    void syncChannels();

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { passive: true });
    }
    window.addEventListener("focus", handleActivity);
    document.addEventListener("visibilitychange", handleVisibility);

    const intervalId = window.setInterval(() => {
      void publishPresence(false);
    }, PRESENCE_IDLE_TICK_MS);

    const onConnected = () => {
      void syncChannels();
    };
    ably.connection.on("connected", onConnected);

    return () => {
      cancelled = true;
      syncQueued = false;
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity);
      }
      window.removeEventListener("focus", handleActivity);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearInterval(intervalId);
      ably.connection.off("connected", onConnected);

      for (const channel of channels.values()) {
        void channel.presence.leave().catch(() => undefined);
        safeDetachChannel(channel);
      }
      channels.clear();
    };
  }, [ably]);
}
