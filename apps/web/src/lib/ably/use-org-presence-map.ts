"use client";

import {
  aggregateChatPresenceByUserId,
  type ChatPresenceState,
  makeOrgPresenceChannelName,
  type PresenceConnectionInput,
} from "@sokosumi/utils";
import type * as Ably from "ably";
import { useAbly } from "ably/react";
import { useEffect, useState } from "react";

import { organizationIdsFromAblyCapability } from "./organization-ids-from-ably-capability";

const RECLASSIFY_TICK_MS = 30_000;

function samePresenceMap(
  a: Map<string, ChatPresenceState>,
  b: Map<string, ChatPresenceState>,
): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [userId, state] of a) {
    if (b.get(userId) !== state) {
      return false;
    }
  }
  return true;
}

function membersToInputs(
  members: Ably.PresenceMessage[],
): PresenceConnectionInput[] {
  return members.map((member) => ({
    clientId: member.clientId ?? "",
    data: member.data,
  }));
}

/**
 * Live org presence map: userId → online | afk.
 * Users absent from the map are offline (caller uses fallback).
 *
 * Gates attach on token capability (same as publisher). Attaching
 * `presence:org_*` without a grant yields Ably capability-denied failures
 * (SOKOSUMI-R0) as unhandled rejections. Re-syncs on `connected` so a
 * transient auth/grant miss can recover without remounting.
 */
export function useOrgPresenceMap(
  organizationId: string | null | undefined,
): Map<string, ChatPresenceState> {
  const ably = useAbly();
  const [presenceByUserId, setPresenceByUserId] = useState<
    Map<string, ChatPresenceState>
  >(() => new Map());

  useEffect(() => {
    if (!organizationId) {
      setPresenceByUserId(new Map());
      return;
    }

    // Narrow for async start() — TS does not carry control-flow into closures.
    const activeOrganizationId = organizationId;
    // Drop prior org roster immediately so UI does not flash stale members
    // while authorize runs for the new workspace.
    setPresenceByUserId(new Map());

    let cancelled = false;
    let channel: Ably.RealtimeChannel | null = null;
    let members = new Map<string, Ably.PresenceMessage>();
    let intervalId: number | undefined;
    /** Coalesce mount + connected so authorize never overlaps. */
    let syncInFlight = false;
    let syncQueued = false;

    function recompute() {
      if (cancelled) {
        return;
      }
      const inputs = membersToInputs([...members.values()]);
      const next = aggregateChatPresenceByUserId(inputs);
      setPresenceByUserId((previous) =>
        samePresenceMap(previous, next) ? previous : next,
      );
    }

    function upsertMember(message: Ably.PresenceMessage) {
      const clientId = message.clientId;
      if (!clientId) {
        return;
      }
      members.set(clientId, message);
      recompute();
    }

    function removeMember(message: Ably.PresenceMessage) {
      const clientId = message.clientId;
      if (!clientId) {
        return;
      }
      members.delete(clientId);
      recompute();
    }

    function unsubscribePresence() {
      if (!channel) {
        return;
      }
      channel.presence.unsubscribe("enter", upsertMember);
      channel.presence.unsubscribe("update", upsertMember);
      channel.presence.unsubscribe("present", upsertMember);
      channel.presence.unsubscribe("leave", removeMember);
      channel.presence.unsubscribe("absent", removeMember);
    }

    function tearDownSubscription() {
      unsubscribePresence();
      channel = null;
      members = new Map();
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
      if (!cancelled) {
        setPresenceByUserId(new Map());
      }
    }

    async function hydrate() {
      if (!channel) {
        return;
      }
      try {
        const current = await channel.presence.get();
        if (cancelled) {
          return;
        }
        members = new Map(
          current
            .filter((message) => message.clientId)
            .map((message) => [message.clientId as string, message]),
        );
        recompute();
      } catch (error) {
        console.error("Ably presence.get failed:", error);
      }
    }

    async function runSyncOnce() {
      let tokenDetails: Ably.TokenDetails | null = null;
      try {
        tokenDetails = await ably.auth.authorize();
      } catch (error) {
        if (!cancelled) {
          console.error("Ably authorize for presence map failed:", error);
          // Prior successful attach must not keep handlers/interval/roster after
          // a reconnect auth failure (REST fallback needs empty map).
          tearDownSubscription();
        }
        return;
      }
      if (cancelled) {
        return;
      }

      // Missing/unparseable capability → no attach (never fall back to bare
      // organizationId; that is SOKOSUMI-R0). Empty grant list same.
      const grantedIds =
        organizationIdsFromAblyCapability(tokenDetails?.capability) ?? [];
      if (!grantedIds.includes(activeOrganizationId)) {
        tearDownSubscription();
        return;
      }

      if (!channel) {
        const channelName = makeOrgPresenceChannelName(activeOrganizationId);
        channel = ably.channels.get(channelName);

        channel.presence.subscribe("enter", upsertMember);
        channel.presence.subscribe("update", upsertMember);
        channel.presence.subscribe("present", upsertMember);
        channel.presence.subscribe("leave", removeMember);
        channel.presence.subscribe("absent", removeMember);

        intervalId = window.setInterval(recompute, RECLASSIFY_TICK_MS);
      }

      // Non-resumable reconnects can leave local members stale (ghost Online/AFK).
      // Replace from presence.get() whenever Ably reconnects / re-syncs.
      await hydrate();
    }

    async function syncChannels() {
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

    // Always listen — including after deny/auth fail — so a later reconnect
    // can pick up a grant (publisher re-authorizes on connected the same way).
    const onConnected = () => {
      void syncChannels();
    };
    ably.connection.on("connected", onConnected);
    void syncChannels();

    return () => {
      cancelled = true;
      syncQueued = false;
      ably.connection.off("connected", onConnected);
      if (intervalId != null) {
        window.clearInterval(intervalId);
      }
      unsubscribePresence();
      // Do not detach: publisher owns channel lifecycle on shared RealtimeChannel
      // instances. Detach here would leave this client from org presence.
    };
  }, [ably, organizationId]);

  return presenceByUserId;
}
