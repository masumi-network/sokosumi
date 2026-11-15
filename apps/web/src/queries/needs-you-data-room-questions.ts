import { infiniteQueryOptions } from "@tanstack/react-query";
import { fetchWaitingDataRoomQuestions } from "@/lib/utils/data-room.client";
import { driveStoreForActiveWorkspace } from "@/lib/utils/drive-file-list.client";
import { NEEDS_YOU_TASKS_REFRESH_MS } from "@/queries/needs-you-tasks";

/** Every reader's and workspace's waiting-questions query starts with this. */
export const NEEDS_YOU_DATA_ROOM_QUESTIONS_QUERY_KEY = [
  "needs-you-data-room-questions",
] as const;

/** Questions per page; "Show older questions" reads the next one. */
export const NEEDS_YOU_DATA_ROOM_QUESTIONS_PAGE_SIZE = 20;

/**
 * The questions viewers asked in the active workspace's data rooms that the
 * reader runs and nobody has answered yet, newest first, a page at a time.
 * Every page carries the total, so the tab counts them all. Keyed by reader
 * and workspace like the waiting Tasks, and read again on the same timer: a
 * viewer asks from outside Sokosumi, so no realtime event reaches the reader.
 */
export function needsYouDataRoomQuestionsQueryOptions(
  userId: string | undefined,
  organizationId: string | null,
) {
  return infiniteQueryOptions({
    queryKey: [
      ...NEEDS_YOU_DATA_ROOM_QUESTIONS_QUERY_KEY,
      userId ?? null,
      organizationId,
    ],
    queryFn: ({ pageParam }) =>
      fetchWaitingDataRoomQuestions({
        store: driveStoreForActiveWorkspace(organizationId),
        cursor: pageParam,
        limit: NEEDS_YOU_DATA_ROOM_QUESTIONS_PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(userId),
    // An answer given in the room must take the row away when Needs you opens again.
    staleTime: 0,
    // ponytail: poll while on screen, a room channel if this ever must be live.
    refetchInterval: NEEDS_YOU_TASKS_REFRESH_MS,
  });
}

/** The room page's address that opens this question ready to answer. */
export function dataRoomQuestionHref(question: {
  roomId: string;
  id: string;
}): string {
  return `/drive/data-rooms/${encodeURIComponent(question.roomId)}?tab=questions&question=${encodeURIComponent(question.id)}`;
}
