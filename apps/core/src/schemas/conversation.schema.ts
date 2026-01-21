import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

/**
 * Conversation response schema.
 * CRITICAL: openaiId is intentionally NOT included in response schema
 * to prevent users from accessing other users' conversations.
 */
export const conversationSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "Internal database ID",
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    userId: z.string().uuid().openapi({
      description: "User ID who owns this conversation",
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    title: z
      .string()
      .nullable()
      .openapi({
        description: "Conversation title",
        example: "Chat with Hannah",
      }),
    metadata: z
      .record(z.unknown())
      .nullable()
      .openapi({
        description: "Additional metadata (coworker info, etc.)",
        example: { coworker: "Hannah", useCase: "Customer support" },
      }),
    createdAt: dateTimeSchema.openapi({
      description: "When the conversation was created",
    }),
    updatedAt: dateTimeSchema.openapi({
      description: "When the conversation was last updated",
    }),
    // openaiId is intentionally NOT included in response schema
  })
  .openapi("Conversation");

export type Conversation = z.infer<typeof conversationSchema>;

/**
 * Request schema for creating a new conversation mapping.
 * openaiId is accepted in request but never returned in response.
 */
export const createConversationRequestSchema = z
  .object({
    openaiId: z
      .string()
      .min(1)
      .openapi({
        description:
          "OpenAI conversation ID (stored but never exposed in responses)",
        example: "conv_abc123xyz",
      }),
    title: z
      .string()
      .optional()
      .openapi({
        description: "Conversation title",
        example: "Chat with Hannah",
      }),
    metadata: z
      .record(z.unknown())
      .optional()
      .openapi({
        description: "Additional metadata",
        example: { coworker: "Hannah", useCase: "Customer support" },
      }),
  })
  .openapi("CreateConversationRequest");

export type CreateConversationRequest = z.infer<
  typeof createConversationRequestSchema
>;

/**
 * Request schema for updating conversation metadata.
 */
export const updateConversationRequestSchema = z
  .object({
    title: z
      .string()
      .optional()
      .openapi({
        description: "Conversation title",
        example: "Updated chat title",
      }),
    metadata: z
      .record(z.unknown())
      .optional()
      .openapi({
        description: "Additional metadata",
        example: { coworker: "John", useCase: "Technical support" },
      }),
  })
  .openapi("UpdateConversationRequest");

export type UpdateConversationRequest = z.infer<
  typeof updateConversationRequestSchema
>;

/**
 * Response schema for listing conversations.
 */
export const conversationListResponseSchema = z
  .array(conversationSchema)
  .openapi("ConversationList");
