import type { ChatCatchUpSummary } from "@sokosumi/core-client";
import { getChatsSignalsSummaryResponseTransformer } from "@sokosumi/core-client/transformers";

/**
 * One room's written summary, from the background route rather than a server
 * action. Not `fetchBackgroundJson`: its 9s attempt ceiling is below the
 * model call's 15s timeout, so it would cut a slow summary off and ask the
 * model again.
 */
export async function fetchRoomSummary(
  roomId: string,
): Promise<ChatCatchUpSummary> {
  const response = await fetch(
    `/api/chat/${encodeURIComponent(roomId)}/summary`,
    {
      cache: "no-store",
      redirect: "error",
    },
  );
  if (!response.ok) throw new Error(`Summary unavailable (${response.status})`);
  return (
    await getChatsSignalsSummaryResponseTransformer(await response.json())
  ).data;
}
