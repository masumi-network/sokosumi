import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import * as Sentry from "@sentry/nextjs";
import { convertToModelMessages, streamText } from "ai";
import { NextRequest } from "next/server";

import { getEnvSecrets } from "@/config/env.secrets";
import {
  addConversationItem,
  getConversationId,
} from "@/lib/actions/conversation/core-api-actions";
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
    const body = await req.json();
    const { messages, conversationId } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "Invalid messages format" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    let internalConversationId: string | null = null;

    // If conversationId is provided, validate ownership via Core API
    // This ensures users can only access their own conversations
    if (conversationId) {
      const validationResult = await getConversationId({
        id: conversationId,
      });

      if (validationResult.isErr()) {
        return new Response(
          JSON.stringify({ error: validationResult.error.message }),
          { status: 403 },
        );
      }

      // Get internal conversation ID for use with Core API
      internalConversationId = validationResult.value.conversationId;
    }

    const modelMessages = await convertToModelMessages(messages);

    // Add the latest user message to conversation via Core API if we have a conversation ID
    if (internalConversationId && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === "user") {
        // Format content for Core API - Responses API format: [{"type": "input_text", "text": "..."}]
        let formattedContent: Array<{ type: string; text: string }>;

        const msgAny = lastMessage as Record<string, unknown>;
        let extractedText = "";

        // Extract text content from various message formats
        // Check if content exists and is a string
        if ("content" in msgAny && typeof msgAny.content === "string") {
          extractedText = msgAny.content;
        }
        // Check if content exists and is an array
        else if ("content" in msgAny && Array.isArray(msgAny.content)) {
          extractedText = msgAny.content
            .map((c: unknown): string => {
              if (typeof c === "string") return c;
              const part = c as { type?: string; text?: string };
              return part.text || "";
            })
            .filter(Boolean)
            .join("");
        }
        // Check if parts exists (AI SDK v6 format)
        else if ("parts" in msgAny && Array.isArray(msgAny.parts)) {
          extractedText = msgAny.parts
            .map((part: unknown): string => {
              if (typeof part === "string") return part;
              const partObj = part as { type?: string; text?: string };
              return partObj.text || "";
            })
            .filter(Boolean)
            .join("");
        }
        // Fallback: try to extract text from any property
        else {
          extractedText = "";
        }

        // Format as Responses API input_text array
        formattedContent = extractedText
          ? [{ type: "input_text", text: extractedText }]
          : [];

        // Add user message to conversation via Core API (fire-and-forget)
        addConversationItem({
          conversationId: internalConversationId,
          role: "user",
          content: formattedContent,
        }).catch((error) => {
          // Log error but don't fail the request
          console.error(
            "Failed to add user message to conversation via Core API:",
            error,
          );
        });
      }
    }

    const result = await streamText({
      model: openrouter("openai/gpt-4o-mini"),
      messages: modelMessages,
      maxOutputTokens: 4096,
    });

    // Note: Assistant messages can be added to conversation via Core API after streaming completes
    // This can be handled by the client or a separate endpoint that processes the stream

    return result.toUIMessageStreamResponse();
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        context: "chat_api",
      },
    });
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
