import { z } from "@hono/zod-openapi";
import { isChatUiProviderReasoningPartType } from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import { isSafeRemoteUrl } from "@/helpers/safe-url";

/**
 * OpenAI [Responses easy input](https://platform.openai.com/docs/guides/text)–style
 * text block (`input_text`). Stored Sokosumi UI messages use AI SDK `text` parts; both
 * shapes are documented here for API consumers.
 */
export const responsesApiInputTextPartSchema = z
  .object({
    type: z.literal("input_text"),
    text: z.string(),
  })
  .openapi({
    description:
      "Responses API easy-input text item (maps to user/assistant text in model input).",
  });

/**
 * AI SDK / UI message parts persisted for chat (reasoning then text in `conversationMessagesToUiMessages`).
 * `type` is usually `reasoning` but may be provider-specific (e.g. redacted variants).
 *
 * `type` is required so `{ text }` alone cannot match this branch of the request-part union; otherwise
 * user/system messages would accept it as reasoning and `mapChatRequestToUiMessages` would strip it.
 */
export const chatUiReasoningPartSchema = z
  .object({
    type: z.string(),
    text: z.string(),
  })
  .refine((part) => isChatUiProviderReasoningPartType(part.type), {
    message:
      "Reasoning parts require an allowlisted type (reasoning or redacted_reasoning).",
  });

export const chatUiTextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

/** Assistant / Responses-style text block (same shape as `text`; accepted on ingress for compatibility). */
export const chatUiOutputTextPartSchema = z.object({
  type: z.literal("output_text"),
  text: z.string(),
});

export const chatUiFilePartSchema = z.object({
  type: z.literal("file"),
  url: z
    .string()
    .url()
    .refine((value) => isSafeRemoteUrl(value), {
      message: "File URL must use http or https.",
    }),
  mediaType: z.string(),
  filename: z.string().optional(),
});

/**
 * Shared union for typed chat body parts: POST `/v1/chat` requests, persisted
 * conversation messages, and GET `/v1/chat` UI payloads. Extend here only once
 * when adding a new part type.
 */
export const chatMessageContentPartSchema = z.union([
  chatUiFilePartSchema,
  chatUiTextPartSchema,
  responsesApiInputTextPartSchema,
  chatUiOutputTextPartSchema,
  chatUiReasoningPartSchema,
]);

/** Alias for GET `/v1/chat` and OpenAPI; identical to `chatMessageContentPartSchema`. */
export const chatUiMessagePartSchema = chatMessageContentPartSchema;

export const chatUiThoughtTimingMetadataSchema = z.object({
  thoughtStartedAtMs: z.number(),
  thoughtEndedAtMs: z.number(),
});

export const chatUiMessageMetadataSchema = chatUiThoughtTimingMetadataSchema
  .partial()
  .extend({
    imageGeneration: z.boolean().optional(),
  });

/**
 * AI SDK `UIMessage`-compatible object returned by GET /v1/chat (`data.messages`).
 * Aligns with OpenAI-style roles and text-shaped content parts.
 */
export const chatUiMessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(["user", "assistant", "system"]),
    parts: z.array(chatUiMessagePartSchema),
    metadata: chatUiMessageMetadataSchema.optional(),
  })
  .openapi("ChatUiMessage");

/** `data` payload for GET /v1/chat success responses. */
export const getChatUiMessagesResponseDataSchema = z
  .object({
    messages: z.array(chatUiMessageSchema),
  })
  .openapi("GetChatUiMessagesResponseData");

export const getRoomChatUiMessagesQuerySchema = z
  .object({
    cursor: z
      .string()
      .optional()
      .openapi({
        param: { name: "cursor", in: "query" },
        description:
          "Cursor for pagination (id of the last message from the previous page).",
      }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIMITS.CHAT_UI_MESSAGES_MAX_LIMIT)
      .default(LIMITS.CHAT_UI_MESSAGES_DEFAULT_LIMIT)
      .openapi({
        param: { name: "limit", in: "query" },
        description: `Page size (max ${LIMITS.CHAT_UI_MESSAGES_MAX_LIMIT}). Cursor pagination metadata is always returned for forward compatibility.`,
        example: LIMITS.CHAT_UI_MESSAGES_DEFAULT_LIMIT,
      }),
  })
  .openapi("GetRoomChatUiMessagesQuery");

export const getChatUiMessagesQuerySchema = z
  .object({
    conversationId: z
      .string()
      .uuid()
      .openapi({
        param: { name: "conversationId", in: "query" },
        description: "Internal conversation id",
        example: "550e8400-e29b-41d4-a716-446655440000",
      }),
    cursor: z
      .string()
      .optional()
      .openapi({
        param: { name: "cursor", in: "query" },
        description:
          "Cursor for pagination (id of the last message from the previous page).",
      }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIMITS.CHAT_UI_MESSAGES_MAX_LIMIT)
      .default(LIMITS.CHAT_UI_MESSAGES_DEFAULT_LIMIT)
      .openapi({
        param: { name: "limit", in: "query" },
        description: `Page size (max ${LIMITS.CHAT_UI_MESSAGES_MAX_LIMIT}). Cursor pagination metadata is always returned for forward compatibility.`,
        example: LIMITS.CHAT_UI_MESSAGES_DEFAULT_LIMIT,
      }),
  })
  .openapi("GetChatUiMessagesQuery");
