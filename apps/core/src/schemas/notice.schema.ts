import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { noticeKindSchema } from "@/schemas/domain-enums.schema";

export const noticeSchema = z
  .object({
    id: z.string().openapi({ example: "notice_123" }),
    kind: noticeKindSchema.openapi({ example: "LEGAL_TERMS" }),
    bodyMarkdown: z
      .string()
      .openapi({ example: "## Notice\nPlease review this announcement." }),
    effectiveAt: dateTimeSchema,
    isActive: z.boolean().openapi({ example: true }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("Notice");

export type Notice = z.infer<typeof noticeSchema>;
export type NoticeKind = z.infer<typeof noticeKindSchema>;

export const pendingNoticesResponseSchema = z.object({
  pendingNotices: z.array(noticeSchema),
});

export const noticeAcknowledgmentResponseSchema = z.object({
  noticeId: z.string().openapi({ example: "notice_123" }),
  acknowledgedAt: dateTimeSchema,
  alreadyAcknowledged: z.boolean().openapi({ example: false }),
});
