import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { seoWorkspaceQuerySchema } from "@/schemas/project-seo.schema";

export const SEO_CHAT_MAX_QUESTION_CHARS = 4_000;
export const SEO_CHAT_HISTORY_LIMIT = 20;
export const SEO_CHAT_MAX_ACTIONS = 5;

export const seoChatActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("connect"),
      provider: z.enum(["ga4", "search_console"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("open"),
      dialog: z.enum([
        "page",
        "keyword",
        "competitor",
        "import",
        "analysis",
        "statistics",
        "page_change",
      ]),
    })
    .strict(),
]);

export const seoChatReplySchema = z
  .object({
    reply: z.string().trim().min(1).max(12_000),
    actions: z.array(seoChatActionSchema).max(SEO_CHAT_MAX_ACTIONS),
  })
  .strict();

export const sendSeoChatSchema = z
  .object({
    question: z.string().trim().min(1).max(SEO_CHAT_MAX_QUESTION_CHARS),
    idempotencyKey: z.string().trim().min(8).max(128),
    scope: seoWorkspaceQuerySchema.optional(),
  })
  .strict()
  .openapi("SendSeoAuditChatRequest");

export const seoChatScopeSchema = z.object({
  name: z.string(),
  pageIds: z.array(z.uuid()),
  scopeId: z.uuid().nullable(),
  version: z.number().int(),
  from: z.string().nullable(),
  to: z.string().nullable(),
});

export const seoChatTurnSchema = z
  .object({
    id: z.uuid(),
    question: z.string(),
    response: z.string().nullable(),
    actions: z.array(seoChatActionSchema),
    status: z.enum(["running", "completed", "failed"]),
    scope: seoChatScopeSchema,
    createdAt: dateTimeSchema,
  })
  .openapi("SeoAuditChatTurn");

export const seoChatHistorySchema = z
  .object({
    turns: z.array(seoChatTurnSchema),
  })
  .openapi("SeoAuditChatHistory");

export type SeoChatAction = z.infer<typeof seoChatActionSchema>;
export type SeoChatReply = z.infer<typeof seoChatReplySchema>;
export type SendSeoChat = z.infer<typeof sendSeoChatSchema>;
export type SeoChatTurn = z.infer<typeof seoChatTurnSchema>;
