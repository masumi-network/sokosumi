import { chatResultPreviewService } from "@/lib/services/chat-result-preview.service";
import { respondToBackgroundChatRead } from "../../../../background-read";
export async function GET(
  _request: Request,
  context: { params: Promise<{ roomId: string; messageId: string }> },
) {
  const { roomId, messageId } = await context.params;
  return respondToBackgroundChatRead("Results unavailable", async () => ({
    data: await chatResultPreviewService.forMessage(roomId, messageId),
  }));
}
