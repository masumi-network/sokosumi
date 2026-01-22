import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { convertToModelMessages, streamText } from "ai";
import { NextRequest } from "next/server";

import { getEnvSecrets } from "@/config/env.secrets";
import { getOpenaiConversationId } from "@/lib/actions/conversation";
import { getSession } from "@/lib/auth/utils";

const openrouter = createOpenRouter({
  apiKey: getEnvSecrets().OPENROUTER_CHAT_API_KEY || "",
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const { messages, conversationId } = await req.json();

    // If conversationId is provided, validate ownership
    // This ensures users can only access their own conversations
    if (conversationId) {
      const validationResult = await getOpenaiConversationId({
        id: conversationId,
      });

      if (validationResult.isErr()) {
        return new Response(
          JSON.stringify({ error: validationResult.error.message }),
          { status: 403 },
        );
      }
      // Conversation ownership validated - proceed with chat
    }

    const modelMessages = await convertToModelMessages(messages);

    const result = await streamText({
      model: openrouter("openai/gpt-4o-mini"),
      messages: modelMessages,
      maxOutputTokens: 4096,
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
