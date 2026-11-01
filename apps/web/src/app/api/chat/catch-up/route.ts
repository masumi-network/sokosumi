import { chatSignalsService } from "@/lib/services/chat-signals.service";

import { respondToBackgroundChatRead } from "../background-read";

/**
 * The reader's catch-up across every room. The model call can take seconds,
 * so it stays out of the server action queue that carries Done, Reply and
 * Mark read (see `respondToBackgroundChatRead`).
 */
export async function GET() {
  return respondToBackgroundChatRead("Summary unavailable", async () => ({
    data: await chatSignalsService.getSummary(),
  }));
}
