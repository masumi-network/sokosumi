import {
  conversationItemRepository,
  conversationRepository,
} from "@sokosumi/database/repositories";
import type { Prisma } from "@sokosumi/database/src/generated/prisma/client.js";

/**
 * Message format for OpenRouter Responses API
 * Used when fetching conversation history for AI response generation
 */
export interface ResponseMessage {
  role: "user" | "assistant" | "system";
  content: string | Array<{ type: string; text?: string }>;
}

/**
 * Fetches conversation history from the database for use with OpenRouter's Responses API.
 * Database is the source of truth for conversation messages.
 *
 * @param conversationId - Internal database conversation ID
 * @param userId - User ID for ownership validation
 * @param prisma - Prisma client
 * @returns Array of messages in OpenRouter Responses API format, or null if conversation not found
 */
export async function getConversationHistory(
  conversationId: string,
  userId: string,
  prisma: Prisma.TransactionClient,
): Promise<ResponseMessage[] | null> {
  // Validate ownership
  const conversation = await conversationRepository.getConversationById(
    conversationId,
    userId,
    prisma,
  );

  if (!conversation) {
    return null;
  }

  // Fetch all conversation items ordered by creation time
  const items = await conversationItemRepository.getItemsByConversationId(
    conversation.id,
    prisma,
  );

  // Map to OpenRouter Responses API format
  return items.map((item) => ({
    role: item.role as "user" | "assistant" | "system",
    content: item.content as string | Array<{ type: string; text?: string }>,
  }));
}
