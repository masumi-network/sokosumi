"use client";

import type { ChatPresenceState } from "@sokosumi/utils";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useState,
} from "react";

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

/**
 * Ably island: sync live map into parent state. Must not wrap paint-critical UI.
 */
function OrgPresenceMapSync({
  organizationId,
  onMapChange,
}: {
  organizationId: string | null;
  onMapChange: (map: Map<string, ChatPresenceState>) => void;
}) {
  const presenceByUserId = useOrgPresenceMap(organizationId);

  useEffect(() => {
    onMapChange(presenceByUserId);
  }, [onMapChange, presenceByUserId]);

  return null;
}

interface OrgPresenceProviderProps {
  /** Active workspace org; null for personal → empty map (humans use REST fallback). */
  organizationId: string | null;
  children: ReactNode;
}

/**
 * App-shell Ably presence (ADR-0002).
 * Children always mount with context (REST fallback until Ably hydrates).
 * Publisher + map live in a LazyAbly **sibling island** so Instant chrome is
 * never blocked on the Ably chunk (same pattern as NotificationProvider).
 */
export function OrgPresenceProvider({
  organizationId,
  children,
}: OrgPresenceProviderProps) {
  const [presenceByUserId, setPresenceByUserId] = useState<
    Map<string, ChatPresenceState>
  >(() => new Map());

  const handleMapChange = useCallback((map: Map<string, ChatPresenceState>) => {
    setPresenceByUserId((previous) => {
      if (previous.size === map.size) {
        let same = true;
        for (const [userId, presence] of map) {
          if (previous.get(userId) !== presence) {
            same = false;
            break;
          }
        }
        if (same) {
          return previous;
        }
      }
      return map;
    });
  }, []);

  useEffect(() => {
    if (organizationId == null) {
      setPresenceByUserId(new Map());
    }
  }, [organizationId]);

  return (
    <OrgPresenceMapContext value={presenceByUserId}>
      {children}
      <LazyAblyProvider>
        <OrgPresencePublisherBridge />
        <OrgPresenceMapSync
          organizationId={organizationId}
          onMapChange={handleMapChange}
        />
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
