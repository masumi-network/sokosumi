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

const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
] as const;

/** Throttle presence.update while active; enter/leave still immediate. */
const PRESENCE_UPDATE_MIN_INTERVAL_MS = 30_000;
const PRESENCE_IDLE_TICK_MS = 30_000;

function buildPresenceData(
  lastActiveAt: number,
  visible: boolean,
): ChatPresenceMemberData {
  return { lastActiveAt, visible };
}

/**
 * Enter Ably Presence on every org channel granted on the token (ADR-0002).
 * Updates lastActiveAt / visible from browser activity and visibility.
 */
export function useOrgPresencePublisher(): void {
  const ably = useAbly();
  const channelsRef = useRef(new Map<string, Ably.RealtimeChannel>());
  const lastActiveAtRef = useRef(Date.now());
  const lastPublishedAtRef = useRef(0);
  const lastPublishedVisibleRef = useRef<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const channels = channelsRef.current;

    async function publishPresence(force: boolean): Promise<void> {
      const visible = !document.hidden;
      const now = Date.now();
      const lastActiveAt = lastActiveAtRef.current;
      const data = buildPresenceData(lastActiveAt, visible);

      const shouldPublish =
        force ||
        lastPublishedVisibleRef.current !== visible ||
        now - lastPublishedAtRef.current >= PRESENCE_UPDATE_MIN_INTERVAL_MS;

      if (!shouldPublish || channels.size === 0) {
        return;
      }

      lastPublishedAtRef.current = now;
      lastPublishedVisibleRef.current = visible;

      await Promise.all(
        [...channels.values()].map(async (channel) => {
          try {
            await channel.presence.update(data);
          } catch {
            try {
              await channel.presence.enter(data);
            } catch (error) {
              console.error("Ably presence enter/update failed:", error);
            }
          }
        }),
      );
    }

    async function syncChannels(): Promise<void> {
      let tokenDetails: Ably.TokenDetails | null = null;
      try {
        tokenDetails = await ably.auth.authorize();
      } catch (error) {
        console.error("Ably authorize for presence failed:", error);
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

      const data = buildPresenceData(lastActiveAtRef.current, !document.hidden);

      for (const name of nextNames) {
        if (channels.has(name)) {
          continue;
        }
        const channel = ably.channels.get(name);
        channels.set(name, channel);
        try {
          await channel.presence.enter(data);
        } catch (error) {
          console.error("Ably presence enter failed:", error);
        }
      }

      lastPublishedAtRef.current = Date.now();
      lastPublishedVisibleRef.current = !document.hidden;
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
