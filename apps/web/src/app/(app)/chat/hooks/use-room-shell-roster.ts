"use client";

import { useQuery } from "@tanstack/react-query";
import type { RoomShellRosterPage } from "@/app/chat/load-room-shell-roster";
import { chatQueryKeys } from "@/queries/chat";

export const FAILED_ROOM_SHELL_ROSTER: RoomShellRosterPage = {
  organizationMembers: [],
  membersLoadFailed: true,
  coworkers: [],
  sokoBots: [],
};

const rosterPromiseIds = new WeakMap<Promise<RoomShellRosterPage>, number>();
let nextRosterPromiseId = 1;

function getRosterPromiseId(promise: Promise<RoomShellRosterPage>): number {
  const existing = rosterPromiseIds.get(promise);
  if (existing !== undefined) return existing;
  const id = nextRosterPromiseId++;
  rosterPromiseIds.set(promise, id);
  return id;
}

interface UseRoomShellRosterOptions {
  currentUserId: string;
  workspaceId: string | null;
  roomId: string | null;
  rosterPromise?: Promise<RoomShellRosterPage>;
  fallback: RoomShellRosterPage;
}

export interface RoomShellRosterState extends RoomShellRosterPage {
  ready: boolean;
}

/**
 * Room shell roster (organization members, coworkers, Soko Bots) backed by
 * React Query under `chatQueryKeys.roster`. Follows the server-streamed
 * `rosterPromise` without suspending the room shell; each distinct server
 * promise gets its own key so a newer promise (room switch, RSC refresh,
 * workspace return) is read fresh and an older promise can never overwrite it.
 */
export function useRoomShellRoster({
  currentUserId,
  workspaceId,
  roomId,
  rosterPromise,
  fallback,
}: UseRoomShellRosterOptions): RoomShellRosterState {
  const enabled = rosterPromise != null && roomId != null;
  const promiseId =
    rosterPromise != null ? getRosterPromiseId(rosterPromise) : undefined;
  const queryKey = chatQueryKeys.roster(
    { userId: currentUserId, workspaceId },
    roomId ?? "",
    promiseId,
  );

  const query = useQuery<RoomShellRosterPage>({
    queryKey,
    queryFn: async () => {
      if (rosterPromise == null) {
        return FAILED_ROOM_SHELL_ROSTER;
      }
      try {
        return await rosterPromise;
      } catch {
        return FAILED_ROOM_SHELL_ROSTER;
      }
    },
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    networkMode: "always",
  });

  const resolved = enabled ? query.data : undefined;

  return {
    organizationMembers:
      resolved?.organizationMembers ?? fallback.organizationMembers,
    coworkers: resolved?.coworkers ?? fallback.coworkers,
    sokoBots: resolved?.sokoBots ?? fallback.sokoBots,
    membersLoadFailed:
      resolved?.membersLoadFailed ?? fallback.membersLoadFailed,
    ready: !enabled || query.data !== undefined,
  };
}
