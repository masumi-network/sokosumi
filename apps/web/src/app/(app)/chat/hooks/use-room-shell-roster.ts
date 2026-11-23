"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { loadRoomShellRosterAction } from "@/app/chat/actions";
import type { RoomShellRosterPage } from "@/app/chat/load-room-shell-roster";
import { useOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import { chatQueryKeys } from "@/queries/chat";

export const FAILED_ROOM_SHELL_ROSTER: RoomShellRosterPage = {
  organizationMembers: [],
  membersLoadFailed: true,
  coworkers: [],
  sokoBots: [],
};

const consumedRosterPromises = new WeakSet<Promise<RoomShellRosterPage>>();

interface UseRoomShellRosterOptions {
  currentUserId: string;
  workspaceId: string | null;
  roomId: string | null;
  /** Organization whose members populate the roster (room's org on a Room visit, else active org). */
  organizationIdForRoster: string | null;
  rosterPromise?: Promise<RoomShellRosterPage>;
  fallback: RoomShellRosterPage;
}

export interface RoomShellRosterState extends RoomShellRosterPage {
  ready: boolean;
}

/**
 * Room shell roster (organization members, coworkers, Soko Bots) backed by
 * React Query under `chatQueryKeys.roster`. Uses the server-streamed
 * `rosterPromise` as its first result without suspending the room shell, and
 * refreshes via `loadRoomShellRosterAction` when a roster event invalidates it.
 */
export function useRoomShellRoster({
  currentUserId,
  workspaceId,
  roomId,
  organizationIdForRoster,
  rosterPromise,
  fallback,
}: UseRoomShellRosterOptions): RoomShellRosterState {
  const queryClient = useQueryClient();
  const enabled = rosterPromise != null && roomId != null;
  const queryKey = chatQueryKeys.roster(
    { userId: currentUserId, workspaceId },
    roomId ?? "",
  );

  const query = useQuery<RoomShellRosterPage>({
    queryKey,
    queryFn: async ({ signal }) => {
      if (rosterPromise != null && !consumedRosterPromises.has(rosterPromise)) {
        consumedRosterPromises.add(rosterPromise);
        return new Promise<RoomShellRosterPage>((resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          const onAbort = () => reject(signal.reason);
          signal.addEventListener("abort", onAbort, { once: true });
          void rosterPromise
            .catch(() => FAILED_ROOM_SHELL_ROSTER)
            .then((page) => {
              signal.removeEventListener("abort", onAbort);
              resolve(page);
            });
        });
      }
      const result = await loadRoomShellRosterAction(organizationIdForRoster);
      if (!result.ok) {
        throw new Error(result.error.message ?? "Could not load room roster.");
      }
      return result.value;
    },
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    networkMode: "always",
  });

  const invalidateRoster = () => {
    void queryClient
      .cancelQueries({ queryKey, exact: true })
      .then(() => queryClient.invalidateQueries({ queryKey, exact: true }));
  };

  useOrganizationChatRoomsChanged(
    {
      onRemoved: (removedRoomId) => {
        if (removedRoomId === roomId) {
          queryClient.removeQueries({ queryKey, exact: true });
        }
      },
      onRoom: (room) => {
        if (room.id === roomId) {
          invalidateRoster();
        }
      },
      onInvalidated: (collections, eventRoomId) => {
        if (collections && !collections.includes("active")) {
          return;
        }
        if (eventRoomId != null && eventRoomId !== roomId) {
          return;
        }
        invalidateRoster();
      },
    },
    enabled,
  );

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
