import type { NextRequest } from "next/server";

import {
  CORE_NEW_CHAT_STREAM_PATH,
  proxyConversationChatPost,
} from "@/api/chat/proxy-conversation-chat-post";

export async function POST(req: NextRequest) {
  return proxyConversationChatPost(req, {
    coreRelativePath: CORE_NEW_CHAT_STREAM_PATH,
    sentryContext: "new_chat_api",
  });
}
