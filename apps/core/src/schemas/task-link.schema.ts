import { z } from "@hono/zod-openapi";
import { TaskLinkType } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const taskLinkSchema = z
  .object({
    id: z.string().openapi({ example: "tl_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    type: z.enum(TaskLinkType).openapi({ example: TaskLinkType.RELATES }),
    fromTaskId: z.string().openapi({ example: "tsk_a" }),
    toTaskId: z.string().openapi({ example: "tsk_b" }),
    peerTaskId: z.string().openapi({ example: "tsk_b" }),
    direction: z
      .enum(["outgoing", "incoming"])
      .openapi({ example: "outgoing" }),
    note: z.string().nullable().openapi({ example: null }),
  })
  .openapi("TaskLink");

export type TaskLinkResponse = z.infer<typeof taskLinkSchema>;

export const taskLinksSchema = z.array(taskLinkSchema);

export const createTaskLinkRequestSchema = z.object({
  toTaskId: z.string().min(1).openapi({ example: "tsk_b" }),
  type: z.enum(TaskLinkType).openapi({ example: TaskLinkType.RELATES }),
  note: z.string().max(2000).nullish().openapi({ example: null }),
});

export const patchTaskLinkRequestSchema = z
  .object({
    type: z.enum(TaskLinkType).optional().openapi({
      example: TaskLinkType.RELATES,
    }),
    note: z.string().max(2000).nullish().openapi({ example: null }),
  })
  .refine((data) => data.type !== undefined || data.note !== undefined, {
    message: "At least one of type or note is required",
    path: ["type", "note"],
  });
