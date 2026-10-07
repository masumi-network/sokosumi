import { coreClientNoRedirect } from "@/lib/clients/core.client";
import { respondToBackgroundChatRead } from "../../../../chat/background-read";
export async function GET(
  _request: Request,
  context: { params: Promise<{ turnId: string }> },
) {
  const { turnId } = await context.params;
  return respondToBackgroundChatRead("Results unavailable", async () => ({
    data: (await coreClientNoRedirect.getMySokoBotTurnResults(turnId)).data,
  }));
}
