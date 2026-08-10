"use client";

import type { ChatPresenceState } from "@sokosumi/utils";
import { createContext, type ReactNode, use, useMemo } from "react";

import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import { useOrgPresenceMap } from "@/lib/ably/use-org-presence-map";
import { useOrgPresencePublisher } from "@/lib/ably/use-org-presence-publisher";
import type { ChatRoomPresence } from "@/lib/clients/generated/core";

const OrgPresenceMapContext = createContext<Map<
  string,
  ChatPresenceState
> | null>(null);

function OrgPresencePublisherBridge() {
  useOrgPresencePublisher();
  return null;
}

function OrgPresenceMapBridge({
  organizationId,
  children,
}: {
  organizationId: string | null;
  children: ReactNode;
}) {
  const presenceByUserId = useOrgPresenceMap(organizationId);
  const value = useMemo(() => presenceByUserId, [presenceByUserId]);

  return (
    <OrgPresenceMapContext value={value}>{children}</OrgPresenceMapContext>
  );
}

interface OrgPresenceProviderProps {
  /** Active workspace org; null for personal → no map (humans show offline). */
  organizationId: string | null;
  children: ReactNode;
}

/**
 * App-shell Ably presence: publish on all orgs from token; subscribe map for
 * active org roster dots (ADR-0002).
 */
export function OrgPresenceProvider({
  organizationId,
  children,
}: OrgPresenceProviderProps) {
  return (
    <LazyAblyProvider>
      <OrgPresencePublisherBridge />
      <OrgPresenceMapBridge organizationId={organizationId}>
        {children}
      </OrgPresenceMapBridge>
    </LazyAblyProvider>
  );
}

/**
 * Resolve teammate presence from live org map; fall back to REST placeholder.
 * Coworkers should not call this (always online on DTO).
 */
export function useMemberPresence(
  userId: string,
  fallback: ChatRoomPresence = "offline",
): ChatRoomPresence {
  const map = use(OrgPresenceMapContext);
  if (map == null) {
    return fallback;
  }
  return (map.get(userId) as ChatRoomPresence | undefined) ?? "offline";
}
