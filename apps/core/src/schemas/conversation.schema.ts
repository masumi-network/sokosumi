import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

/**
 * Conversation response schema.
 * CRITICAL: Internal conversation identifier is intentionally NOT included in response schema
 * to prevent users from accessing other users' conversations.
 */
export const conversationSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "Internal database ID",
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    userId: z.string().openapi({
      description: "User ID who owns this conversation",
      example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj",
    }),
    title: z.string().nullable().openapi({
      description: "Conversation title",
      example: "Chat with Hannah",
    }),
    metadata: z
      .record(z.string(), z.any())
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
    // Internal conversation identifier is intentionally NOT included in response schema
  })
  .openapi("Conversation");

export type Conversation = z.infer<typeof conversationSchema>;

/**
 * Request schema for creating a new conversation mapping.
 * If conversationId is not provided, a new conversation will be created.
 * Internal conversation identifier is never returned in response.
 */
export const createConversationRequestSchema = z
  .object({
    openaiId: z.string().min(1).optional().openapi({
      description:
        "Conversation ID (optional - if not provided, a new conversation will be created)",
      example: "conv_abc123xyz",
    }),
    title: z.string().optional().openapi({
      description: "Conversation title",
      example: "Chat with Hannah",
    }),
    metadata: z
      .record(z.string(), z.any())
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
    title: z.string().optional().openapi({
      description: "Conversation title",
      example: "Updated chat title",
    }),
    metadata: z
      .record(z.string(), z.any())
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

export const conversationWarmupStateSchema = z
  .object({
    conversationId: z.string().uuid().openapi({
      description: "Internal conversation ID",
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    state: z.enum(["pending", "ready", "failed", "unknown"]).openapi({
      description: "Coworker container warmup state",
      example: "ready",
    }),
    completedAt: z.string().datetime().nullable().openapi({
      description:
        "ISO timestamp when warmup reached a terminal state (ready or failed)",
      example: "2025-01-21T12:00:00.000Z",
    }),
    source: z.enum(["redis", "metadata", "none"]).openapi({
      description: "Where the warmup state was resolved from",
      example: "redis",
    }),
  })
  .openapi("ConversationWarmupState");

export type ConversationWarmupState = z.infer<
  typeof conversationWarmupStateSchema
>;
