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

    let cancelled = false;
    const channelName = makeOrgPresenceChannelName(organizationId);
    const channel = ably.channels.get(channelName);
    let members = new Map<string, Ably.PresenceMessage>();

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

    async function hydrate() {
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

    channel.presence.subscribe("enter", upsertMember);
    channel.presence.subscribe("update", upsertMember);
    channel.presence.subscribe("present", upsertMember);
    channel.presence.subscribe("leave", removeMember);
    channel.presence.subscribe("absent", removeMember);

    void hydrate();

    const intervalId = window.setInterval(recompute, RECLASSIFY_TICK_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      channel.presence.unsubscribe("enter", upsertMember);
      channel.presence.unsubscribe("update", upsertMember);
      channel.presence.unsubscribe("present", upsertMember);
      channel.presence.unsubscribe("leave", removeMember);
      channel.presence.unsubscribe("absent", removeMember);
      // Do not detach: publisher owns channel lifecycle on shared RealtimeChannel
      // instances. Detach here would leave this client from org presence.
    };
  }, [ably, organizationId]);

  return presenceByUserId;
}
