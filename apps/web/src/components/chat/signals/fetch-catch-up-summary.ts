import type { ChatCatchUpSummary } from "@sokosumi/core-client";
import { getChatsSignalsSummaryResponseTransformer } from "@sokosumi/core-client/transformers";

/**
 * The written catch-up, one room's or every room's, from the background route
 * rather than a server action, so a slow summary never holds up Done or Mark
 * read. Not `fetchBackgroundJson`: its 9s attempt ceiling is below the model
 * call's timeout, so it would cut a slow summary off and ask the model again.
 */
export async function fetchCatchUpSummary(
  roomId?: string,
): Promise<ChatCatchUpSummary> {
  const response = await fetch(
    roomId
      ? `/api/chat/${encodeURIComponent(roomId)}/summary`
      : "/api/chat/catch-up",
    { cache: "no-store", redirect: "error" },
  );
  if (!response.ok) throw new Error(`Summary unavailable (${response.status})`);
  return (
    await getChatsSignalsSummaryResponseTransformer(await response.json())
  ).data;
}
