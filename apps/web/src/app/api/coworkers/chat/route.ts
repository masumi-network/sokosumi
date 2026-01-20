import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { convertToModelMessages, streamText } from "ai";
import { NextRequest } from "next/server";

import { getEnvSecrets } from "@/config/env.secrets";
import { getSession } from "@/lib/auth/utils";

const openrouter = createOpenRouter({
  apiKey: getEnvSecrets().OPENROUTER_API_KEY || "",
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const { messages } = await req.json();

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
