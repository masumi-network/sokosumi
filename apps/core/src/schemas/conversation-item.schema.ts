import { z } from "@hono/zod-openapi";

/**
 * Conversation item response schema.
 * Content is reconstructed from contentType and contentText columns.
 * Matches the ConversationItem model structure from Prisma schema.
 */
export const conversationItemSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "Conversation item ID",
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    role: z.enum(["user", "assistant"]).openapi({
      description: "Item role",
      example: "user",
    }),
    content: z
      .union([
        z.string(),
        z.array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
          }),
        ),
      ])
      .openapi({
        description:
          "Item content - string for simple text, array for structured content with type",
        example: "Hello!",
      }),
    createdAt: z.number().openapi({
      description: "Unix timestamp in seconds",
      example: 1706284800,
    }),
  })
  .openapi("ConversationItem");

export type ConversationItem = z.infer<typeof conversationItemSchema>;

/**
 * Request schema for creating a conversation item.
 */
export const createConversationItemRequestSchema = z
  .object({
    role: z.enum(["user", "assistant"]).openapi({
      description: "Item role",
      example: "user",
    }),
    content: z
      .union([
        z.string(),
        z.array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
          }),
        ),
      ])
      .openapi({
        description:
          "Item content - string for simple text, array for structured content with type",
        example: "Hello!",
      }),
  })
  .openapi("CreateConversationItemRequest");

export type CreateConversationItemRequest = z.infer<
  typeof createConversationItemRequestSchema
>;
