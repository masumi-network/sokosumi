import "server-only";
import { coreClientNoRedirect } from "@/lib/clients/core.client";
export const chatResultPreviewService = {
  async forMessage(roomId: string, messageId: string) {
    return (
      await coreClientNoRedirect.getChatRoomMessageResults(roomId, messageId)
    ).data;
  },
  async forTurn(turnId: string) {
    return (await coreClientNoRedirect.getMySokoBotTurnResults(turnId)).data;
  },
};
