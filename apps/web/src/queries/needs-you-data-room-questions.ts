import type { WaitingDataRoomQuestions } from "@sokosumi/core-client";
import { queryOptions } from "@tanstack/react-query";
import { fetchWaitingDataRoomQuestions } from "@/lib/utils/data-room.client";
import { driveStoreForActiveWorkspace } from "@/lib/utils/drive-file-list.client";
import { NEEDS_YOU_TASKS_REFRESH_MS } from "@/queries/needs-you-tasks";

/** Every reader's and workspace's waiting-questions query starts with this. */
export const NEEDS_YOU_DATA_ROOM_QUESTIONS_QUERY_KEY = [
  "needs-you-data-room-questions",
] as const;

/**
 * The questions viewers asked in the active workspace's data rooms that the
 * reader runs and nobody has answered yet. Keyed by reader and workspace like
 * the waiting Tasks, and read again on the same timer: a viewer asks from
 * outside Sokosumi, so no realtime event reaches the reader.
 */
export function needsYouDataRoomQuestionsQueryOptions(
  userId: string | undefined,
  organizationId: string | null,
) {
  return queryOptions({
    queryKey: [
      ...NEEDS_YOU_DATA_ROOM_QUESTIONS_QUERY_KEY,
      userId ?? null,
      organizationId,
    ],
    queryFn: (): Promise<WaitingDataRoomQuestions> =>
      fetchWaitingDataRoomQuestions(
        driveStoreForActiveWorkspace(organizationId),
      ),
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
