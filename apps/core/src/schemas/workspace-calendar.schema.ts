import { z } from "@hono/zod-openapi";
import {
  CalendarSourceAccuracy,
  CalendarSourceType,
  CalendarTimeAccuracy,
  TaskScheduleOccurrenceState,
  TaskStatus,
} from "@sokosumi/database";

import { LIMITS } from "@/config/constants";
import { dateTimeSchema } from "@/helpers/datetime";

export const workspaceCalendarQuerySchema = z
  .object({
    from: z.iso.datetime().openapi({
      param: { name: "from", in: "query" },
      description: "Inclusive start of the calendar range",
      example: "2026-06-01T00:00:00.000Z",
    }),
    to: z.iso.datetime().openapi({
      param: { name: "to", in: "query" },
      description:
        "Exclusive end of the calendar range, at most 90 days after from",
      example: "2026-07-01T00:00:00.000Z",
    }),
    scope: z.enum(["owned", "workspace"]).default("workspace").openapi({
      description: "Whether to show only the caller's tasks or the workspace",
      example: "workspace",
    }),
    assigneeId: z.uuid().optional().openapi({
      description:
        "Only occurrences whose planned-series or released-snapshot task has this coworker",
      example: "22222222-2222-7222-8222-222222222222",
    }),
    status: z.enum(TaskStatus).optional().openapi({
      description:
        "Only occurrences whose planned-series or released-snapshot task has this status",
      example: TaskStatus.READY,
    }),
    cursor: z
      .string()
      .max(512)
      .optional()
      .openapi({
        param: { name: "cursor", in: "query" },
        description: "Opaque cursor for the next merged calendar page",
      }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIMITS.MAX_PAGINATION_LIMIT)
      .default(LIMITS.DEFAULT_PAGINATION_LIMIT)
      .openapi({
        param: { name: "limit", in: "query" },
        description: `Number of items to return (max ${LIMITS.MAX_PAGINATION_LIMIT})`,
        example: LIMITS.DEFAULT_PAGINATION_LIMIT,
      }),
  })
  .openapi("WorkspaceCalendarQuery");

export const workspaceCalendarItemSchema = z
  .object({
    id: z.string().openapi({
      description:
        "Stable Calendar item identity. Version 1 projections are display-only.",
      example: "v1:tsk_123:2026-06-01T09:00:00.000Z:2026-06-02T09:00:00.000Z",
    }),
    taskId: z.string().openapi({ example: "tsk_123" }),
    taskName: z.string().openapi({ example: "Prepare release notes" }),
    taskStatus: z.enum(TaskStatus).openapi({ example: "QUEUED" }),
    taskAssigneeId: z.string().nullable().openapi({ example: "coworker_123" }),
    scheduledAt: dateTimeSchema.openapi({
      description: "Effective time at which the item appears in the Calendar",
    }),
    originalScheduledAt: dateTimeSchema.nullable().openapi({
      description:
        "Original scheduled time captured by the occurrence ledger, when known",
    }),
    state: z.enum(TaskScheduleOccurrenceState).openapi({ example: "PLANNED" }),
    sourceId: z.string().openapi({
      description: "Canonical Calendar source identity",
      example: "project:22222222-2222-7222-8222-222222222222",
    }),
    sourceWorkspaceId: z.string().uuid().openapi({
      description: "Workspace captured as the Calendar source",
    }),
    sourceType: z.enum(CalendarSourceType).openapi({ example: "WORKSPACE" }),
    sourceProjectId: z.string().uuid().nullable().openapi({
      description: "Project captured as the Calendar source, when applicable",
    }),
    sourceAccuracy: z.enum(CalendarSourceAccuracy).openapi({
      example: "EXACT",
    }),
    timeAccuracy: z.enum(CalendarTimeAccuracy).openapi({ example: "EXACT" }),
  })
  .openapi("WorkspaceCalendarItem");

export const workspaceCalendarSourceSchema = z
  .object({
    sourceId: z.string().openapi({
      example: "project:22222222-2222-7222-8222-222222222222",
    }),
    sourceType: z.enum(CalendarSourceType).openapi({ example: "PROJECT" }),
    displayName: z.string().openapi({ example: "Q1 research" }),
    logoUrl: z.url().nullable().openapi({ example: null }),
    paletteToken: z.enum(["blue", "violet", "amber"]).openapi({
      description: "Bounded visual marker for Calendar source displays",
      example: "violet",
    }),
  })
  .openapi("WorkspaceCalendarSource");
