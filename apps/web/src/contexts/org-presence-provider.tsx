"use client";

import type { ChatRoomPresence } from "@sokosumi/core-client";
import type { ChatPresenceState } from "@sokosumi/utils";
import {
  createContext,
  type ReactNode,
  use,
  useState,
  useSyncExternalStore,
} from "react";
import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import {
  createOrgPresenceStore,
  EMPTY_ORG_PRESENCE_MAP,
  type OrgPresenceStore,
  useOrgPresenceMapSync,
} from "@/hooks/effects/use-org-presence-map";
import { useOrgPresencePublisher } from "@/lib/ably/use-org-presence-publisher";

const OrgPresenceMapContext = createContext<Map<
  string,
  ChatPresenceState
> | null>(null);

function OrgPresencePublisherBridge({
  organizationId,
}: {
  organizationId: string | null;
}) {
  useOrgPresencePublisher(organizationId);
  return null;
}

/**
 * Ably island: sync live map into the provider's external store. Must not wrap
 * paint-critical UI.
 */
function OrgPresenceMapSync({
  organizationId,
  store,
}: {
  organizationId: string | null;
  store: OrgPresenceStore;
}) {
  useOrgPresenceMapSync(organizationId, store);
  return null;
}

interface OrgPresenceProviderProps {
  /** Active workspace org; null for personal → empty map (humans use REST fallback). */
  organizationId: string | null;
  children: ReactNode;
}

/**
 * App-shell Ably presence (ADR-0003).
 * Children always mount with context (REST fallback until Ably hydrates).
 * Publisher + map live in a LazyAbly **sibling island** so Instant chrome is
 * never blocked on the Ably chunk (same pattern as NotificationProvider).
 */
export function OrgPresenceProvider({
  organizationId,
  children,
}: OrgPresenceProviderProps) {
  const [store] = useState(createOrgPresenceStore);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  const providedPresenceMap =
    organizationId != null && snapshot.organizationId === organizationId
      ? snapshot.map
      : EMPTY_ORG_PRESENCE_MAP;

  return (
    <OrgPresenceMapContext value={providedPresenceMap}>
      {children}
      <LazyAblyProvider>
        <OrgPresencePublisherBridge organizationId={organizationId} />
        <OrgPresenceMapSync organizationId={organizationId} store={store} />
      </LazyAblyProvider>
    </OrgPresenceMapContext>
  );
}

/**
 * Resolve teammate presence from live org map; fall back to REST placeholder
 * until Ably has a member (or forever if Ably unavailable).
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
  return (map.get(userId) as ChatRoomPresence | undefined) ?? fallback;
}
