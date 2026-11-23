"use client";

import type { ChatRoomMessage } from "@sokosumi/core-client";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { chatQueryKeys } from "@/queries/chat";

/** Initial room history page. */
export interface RoomMessagePage {
  messages: ChatRoomMessage[];
  nextCursor: string | null;
  failed: boolean;
  /** Where the Unread divider belongs, when the page says (SOK-1481). */
  firstUnreadMessageId?: string | null;
}

export const FAILED_ROOM_MESSAGE_PAGE: RoomMessagePage = {
  messages: [],
  nextCursor: null,
  failed: true,
};

const messagesPromiseIds = new WeakMap<Promise<RoomMessagePage>, number>();
let nextMessagesPromiseId = 1;

export function getRoomMessagesPromiseId(
  promise: Promise<RoomMessagePage>,
): number {
  const existing = messagesPromiseIds.get(promise);
  if (existing !== undefined) return existing;
  const id = nextMessagesPromiseId++;
  messagesPromiseIds.set(promise, id);
  return id;
}

interface UseRoomInitialMessagesOptions {
  currentUserId: string;
  workspaceId: string | null;
  roomId: string | null;
  messagesPromise?: Promise<RoomMessagePage>;
  queryClient?: QueryClient;
  /** Runs after `messagesPromise` settles in its queryFn (outside render). */
  onSettled?: (page: RoomMessagePage, promiseId: number) => void;
}

export interface RoomInitialMessagesState {
  /** Settled page, or the same room's prior settled page while refreshing. */
  page: RoomMessagePage | undefined;
  /** Settled page for the current promise only (undefined while pending). */
  settledPage: RoomMessagePage | undefined;
  /** Identity of `settledPage`'s server promise. */
  settledPromiseId: number | undefined;
  /** True only before this room has any settled server page. */
  pending: boolean;
}

/**
 * First transcript page backed by React Query under `chatQueryKeys.transcript`.
 * Follows the server-streamed `messagesPromise` without suspending the room
 * shell; each distinct server promise gets its own key so a newer promise
 * (room switch, RSC refresh, workspace return) is read fresh and an older
 * promise can never overwrite it.
 */
export function useRoomInitialMessages({
  currentUserId,
  workspaceId,
  roomId,
  messagesPromise,
  queryClient,
  onSettled,
}: UseRoomInitialMessagesOptions): RoomInitialMessagesState {
  const enabled = messagesPromise != null && roomId != null;
  const promiseId =
    messagesPromise != null
      ? getRoomMessagesPromiseId(messagesPromise)
      : undefined;
  const queryKey = chatQueryKeys.transcript(
    { userId: currentUserId, workspaceId },
    roomId ?? "",
    promiseId,
  );

  const query = useQuery<RoomMessagePage>(
    {
      queryKey,
      queryFn: async () => {
        let page: RoomMessagePage;
        if (messagesPromise == null) {
          page = FAILED_ROOM_MESSAGE_PAGE;
        } else {
          try {
            page = await messagesPromise;
          } catch {
            page = FAILED_ROOM_MESSAGE_PAGE;
          }
        }
        if (promiseId !== undefined) {
          onSettled?.(page, promiseId);
        }
        return page;
      },
      enabled,
      placeholderData: (previousData, previousQuery) => {
        const previousKey = previousQuery?.queryKey;
        if (
          previousData === undefined ||
          !Array.isArray(previousKey) ||
          previousKey.length < 4
        ) {
          return undefined;
        }
        const previousScope = previousKey[0] as
          | { userId?: string | null; workspaceId?: string | null }
          | undefined;
        const sameScope =
          previousScope?.userId === queryKey[0].userId &&
          previousScope?.workspaceId === queryKey[0].workspaceId;
        const sameRoom =
          previousKey[1] === queryKey[1] &&
          previousKey[2] === queryKey[2] &&
          previousKey[3] === queryKey[3];
        return sameScope && sameRoom ? previousData : undefined;
      },
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
      networkMode: "always",
    },
    queryClient,
  );

  const page = enabled ? query.data : undefined;
  const settledPage =
    enabled && !query.isPlaceholderData ? query.data : undefined;

  return {
    page,
    settledPage,
    settledPromiseId: settledPage !== undefined ? promiseId : undefined,
    pending: enabled && query.data === undefined,
  };
}
