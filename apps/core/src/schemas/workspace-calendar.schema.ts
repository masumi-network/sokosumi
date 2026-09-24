import { z } from "@hono/zod-openapi";
import {
  CalendarSourceType,
  TaskScheduleRunState,
  TaskStatus,
} from "@sokosumi/database";

import { LIMITS } from "@/config/constants";
import { dateTimeSchema } from "@/helpers/datetime";

const workspaceCalendarQueryObjectSchema = z.object({
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
    description: "Only items whose Task Schedule or Task has this coworker",
    example: "22222222-2222-7222-8222-222222222222",
  }),
  assigneeUserId: z.string().optional().openapi({
    description:
      "Only items whose Task Schedule or Task is assigned to this workspace member",
  }),
  projectId: z.uuid().optional().openapi({
    description: "Only items with this Project as their Calendar source",
    example: "22222222-2222-7222-8222-222222222222",
  }),
  sourceId: z.string().max(64).optional().openapi({
    description:
      "Only items with this non-Project Calendar source in the current workspace",
    example: "workspace:11111111-1111-7111-8111-111111111111",
  }),
  status: z.enum(TaskStatus).optional().openapi({
    description:
      "Only items whose Task has this status. Planned Runs have no Task yet, so they drop out; RUN_AT Tasks are QUEUED.",
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
});

export const workspaceCalendarQuerySchema = workspaceCalendarQueryObjectSchema
  .refine((query) => !(query.projectId && query.sourceId), {
    message: "projectId and sourceId cannot be combined",
    path: ["sourceId"],
  })
  .openapi("WorkspaceCalendarQuery");

export const projectCalendarQuerySchema = workspaceCalendarQueryObjectSchema
  .omit({ projectId: true, sourceId: true })
  .strict()
  .openapi("ProjectCalendarQuery");

export const workspaceCalendarItemSchema = z
  .object({
    id: z.string().openapi({
      description:
        "The Task Schedule Run this item shows, or the Task for a RUN_AT item",
      example: "00000000-0000-7000-8000-000000000001",
    }),
    kind: z.enum(["RUN", "RUN_AT"]).openapi({
      description:
        "RUN is a Task Schedule Run; RUN_AT is a Queued Task that starts at its Run at",
      example: "RUN",
    }),
    scheduleId: z.string().uuid().nullable().openapi({
      description: "Task Schedule the Run belongs to; null for RUN_AT",
      example: "33333333-3333-7333-8333-333333333333",
    }),
    scheduleRevision: z.number().int().min(0).nullable().openapi({
      description:
        "Task Schedule revision observed with this Run; the expectedRevision for changing it. Null for RUN_AT.",
      example: 3,
    }),
    canChangeRun: z.boolean().openapi({
      description:
        "Whether the caller may skip, move, or restore this Run through PATCH /v1/tasks/schedules/{id}/runs/{runId}",
      example: true,
    }),
    taskId: z.string().nullable().openapi({
      description:
        "Task the Run created (null while planned), or the RUN_AT Task itself",
      example: "tsk_123",
    }),
    taskName: z.string().openapi({
      description: "Name of the Task the Run created, or of the one it creates",
      example: "Prepare release notes",
    }),
    taskStatus: z.enum(TaskStatus).nullable().openapi({
      description:
        "Status of the Task the Run created, or QUEUED for RUN_AT; null while a Run is planned",
      example: "READY",
    }),
    taskAssigneeId: z.string().nullable().openapi({ example: "coworker_123" }),
    taskAssigneeUserId: z
      .string()
      .nullable()
      .optional()
      .openapi({ example: "user_123" }),
    taskOwnerId: z.string().openapi({
      description: "User who owns the Task Schedule and the Tasks it creates",
      example: "user_123",
    }),
    scheduledAt: dateTimeSchema.openapi({
      description: "Effective time at which the item appears in the Calendar",
    }),
    originalScheduledAt: dateTimeSchema.nullable().openapi({
      description:
        "The rule's time for this Run; differs from scheduledAt when the Run was moved",
    }),
    state: z
      .enum([TaskScheduleRunState.PLANNED, TaskScheduleRunState.RELEASED])
      .openapi({
        description:
          "PLANNED is still to come (moved Runs and RUN_AT Tasks too); RELEASED created its Task. Skipped Runs are not on the Calendar.",
        example: "PLANNED",
      }),
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
    paletteToken: z.enum(["blue", "violet"]).openapi({
      description: "Bounded visual marker for Calendar source displays",
      example: "violet",
    }),
    isSchedulable: z.boolean().openapi({
      description:
        "Whether this source may be selected as the project of a Task Schedule created through POST /v1/tasks/schedules. Unschedulable sources remain available for Calendar event display and filtering.",
      example: true,
    }),
  })
  .openapi("WorkspaceCalendarSource");

export const calendarIdentityLabelsRequestSchema = z
  .object({
    refs: z.array(z.string().min(1).max(255)).max(50),
  })
  .strict()
  .openapi("CalendarIdentityLabelsRequest");

export const calendarIdentityLabelSchema = z
  .object({
    ref: z.string(),
    state: z.enum(["current_member", "former_member", "unknown"]),
    label: z.string().optional(),
  })
  .openapi("CalendarIdentityLabel");

export const calendarIdentityLabelsSchema = z
  .array(calendarIdentityLabelSchema)
  .openapi("CalendarIdentityLabels");
