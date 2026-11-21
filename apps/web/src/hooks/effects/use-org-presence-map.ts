"use client";

import {
  aggregateChatPresenceByUserId,
  type ChatPresenceState,
  makeOrgPresenceChannelName,
  type PresenceConnectionInput,
} from "@sokosumi/utils";
import type * as Ably from "ably";
import { useAbly } from "ably/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { authorizeAbly } from "@/lib/ably/authorize.client";
import { organizationIdsFromAblyCapability } from "@/lib/ably/organization-ids-from-ably-capability";
import { getRealtimeChannelEnvironment } from "@/lib/ably/realtime-channel-environment";

const RECLASSIFY_TICK_MS = 30_000;

export const EMPTY_ORG_PRESENCE_MAP = new Map<string, ChatPresenceState>();

export interface OrgPresenceSnapshot {
  organizationId: string | null;
  map: Map<string, ChatPresenceState>;
}

const EMPTY_ORG_PRESENCE_SNAPSHOT: OrgPresenceSnapshot = {
  organizationId: null,
  map: EMPTY_ORG_PRESENCE_MAP,
};

export interface OrgPresenceStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => OrgPresenceSnapshot;
  getServerSnapshot: () => OrgPresenceSnapshot;
  setPresenceMap: (
    organizationId: string | null,
    next: Map<string, ChatPresenceState>,
  ) => void;
}

export function createOrgPresenceStore(): OrgPresenceStore {
  let snapshot: OrgPresenceSnapshot = EMPTY_ORG_PRESENCE_SNAPSHOT;
  const listeners = new Set<() => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    getServerSnapshot() {
      return EMPTY_ORG_PRESENCE_SNAPSHOT;
    },
    setPresenceMap(organizationId, next) {
      if (
        snapshot.organizationId === organizationId &&
        samePresenceMap(snapshot.map, next)
      ) {
        return;
      }
      snapshot = { organizationId, map: next };
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

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
 * Sync live Ably org presence into an external store: userId → online | afk.
 * Users absent from the map are offline (caller uses fallback).
 *
 * Gates attach on token capability (same as publisher). Attaching
 * `presence:org_*` without a grant yields Ably capability-denied failures
 * (SOKOSUMI-R0) as unhandled rejections. Re-syncs on `connected` so a
 * transient auth/grant miss can recover without remounting.
 */
export function useOrgPresenceMapSync(
  organizationId: string | null | undefined,
  store: OrgPresenceStore,
): void {
  const ably = useAbly();

  useEffect(() => {
    if (!organizationId) {
      store.setPresenceMap(null, EMPTY_ORG_PRESENCE_MAP);
      return;
    }

    // Narrow for async runSyncOnce() — TS does not carry control-flow into closures.
    const activeOrganizationId = organizationId;
    // Drop prior org roster immediately so UI does not flash stale members
    // while authorize runs for the new workspace.
    store.setPresenceMap(activeOrganizationId, EMPTY_ORG_PRESENCE_MAP);

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
      store.setPresenceMap(activeOrganizationId, next);
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
        store.setPresenceMap(activeOrganizationId, EMPTY_ORG_PRESENCE_MAP);
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
        tokenDetails = await authorizeAbly(ably);
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
        const channelName = makeOrgPresenceChannelName(
          activeOrganizationId,
          getRealtimeChannelEnvironment(),
        );
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
  }, [ably, organizationId, store]);
}

/**
 * Live org presence map: userId → online | afk.
 * Users absent from the map are offline (caller uses fallback).
 */
export function useOrgPresenceMap(
  organizationId: string | null | undefined,
): Map<string, ChatPresenceState> {
  const [store] = useState(createOrgPresenceStore);
  useOrgPresenceMapSync(organizationId, store);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  return organizationId && snapshot.organizationId === organizationId
    ? snapshot.map
    : EMPTY_ORG_PRESENCE_MAP;
}
