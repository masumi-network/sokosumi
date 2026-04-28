import { z } from "@hono/zod-openapi";

import { LIMITS } from "@/config/constants";
import { CHAT_UI_NON_REASONING_PART_TYPES } from "@/helpers/chat-ui-non-reasoning-part-types";
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
 */
export const chatUiReasoningPartSchema = z
  .object({
    type: z.string().optional(),
    text: z.string(),
  })
  .refine((part) => !CHAT_UI_NON_REASONING_PART_TYPES.has(part.type ?? ""), {
    message: "Use the dedicated schema for text or file parts.",
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

/** Canonical persisted chat part shapes used by GET /chat and conversation history APIs. */
export const chatUiMessagePartSchema = z.union([
  chatUiFilePartSchema,
  chatUiTextPartSchema,
  responsesApiInputTextPartSchema,
  chatUiOutputTextPartSchema,
  chatUiReasoningPartSchema,
]);

export const chatUiThoughtTimingMetadataSchema = z.object({
  thoughtStartedAtMs: z.number(),
  thoughtEndedAtMs: z.number(),
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
    metadata: chatUiThoughtTimingMetadataSchema.optional(),
  })
  .openapi("ChatUiMessage");

/** `data` payload for GET /v1/chat success responses. */
export const getChatUiMessagesResponseDataSchema = z
  .object({
    messages: z.array(chatUiMessageSchema),
  })
  .openapi("GetChatUiMessagesResponseData");

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
