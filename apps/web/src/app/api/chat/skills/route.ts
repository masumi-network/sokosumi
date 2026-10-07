import type { NextRequest } from "next/server";

import { chatRoomService } from "@/lib/services/chat-room.service";

import { respondToBackgroundChatRead } from "../background-read";

/**
 * The chat skill picker's search, read while the person types, so it stays
 * out of the server action queue that carries their sends.
 */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  return respondToBackgroundChatRead("Skills unavailable", async () => ({
    data: await chatRoomService.searchSkills(q),
  }));
}
