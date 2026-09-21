"use client";

import type { ReactNode } from "react";
import { useSession } from "@/lib/auth/auth.client";
import { RoomCacheProvider } from "./room-cache-provider";

/** Auth changes fence history before the next server frame finishes loading. */
export function AuthenticatedRoomCache({
  currentUserId,
  workspaceId,
  children,
}: {
  currentUserId: string;
  workspaceId: string | null;
  children: ReactNode;
}) {
  const session = useSession();
  if (!session.isPending && !session.error && !session.data) return null;
  return (
    <RoomCacheProvider
      currentUserId={session.data?.user.id ?? currentUserId}
      workspaceId={
        session.data
          ? (session.data.session.activeOrganizationId ?? null)
          : workspaceId
      }
    >
      {children}
    </RoomCacheProvider>
  );
}
