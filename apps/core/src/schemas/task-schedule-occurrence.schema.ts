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

export const taskScheduleOccurrenceViewSchema = z
  .enum(["upcoming", "history"])
  .openapi("TaskScheduleOccurrenceView");

export type TaskScheduleOccurrenceView = z.infer<
  typeof taskScheduleOccurrenceViewSchema
>;

export const taskScheduleOccurrenceQuerySchema = z
  .object({
    view: taskScheduleOccurrenceViewSchema.default("upcoming").openapi({
      param: { name: "view", in: "query" },
      description:
        "upcoming lists future planned and skipped occurrences inside the projection horizon, ascending; history lists released, canceled, and past occurrences, descending",
      example: "upcoming",
    }),
    cursor: z
      .string()
      .max(512)
      .optional()
      .openapi({
        param: { name: "cursor", in: "query" },
        description:
          "Opaque cursor from a previous page of the same view. A cursor minted before the schedule revision changed is rejected with kind schedule_cursor_stale.",
      }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIMITS.MAX_PAGINATION_LIMIT)
      .default(LIMITS.DEFAULT_PAGINATION_LIMIT)
      .openapi({
        param: { name: "limit", in: "query" },
        description: `Number of occurrences to return (max ${LIMITS.MAX_PAGINATION_LIMIT})`,
        example: LIMITS.DEFAULT_PAGINATION_LIMIT,
      }),
  })
  .openapi("TaskScheduleOccurrenceQuery");

/**
 * Navigation target for a released occurrence. Released Tasks are independent
 * records, so the ledger exposes only enough to link to one. Archived Tasks
 * keep their summary — history stays truthful — but carry `archivedAt` so the
 * client renders them without a link that would 404.
 */
export const taskScheduleOccurrenceReleasedTaskSchema = z
  .object({
    id: z.string().openapi({ example: "tsk_released" }),
    name: z.string().openapi({ example: "Prepare release notes" }),
    status: z.enum(TaskStatus).openapi({ example: TaskStatus.COMPLETED }),
    archivedAt: dateTimeSchema.nullable().openapi({
      description:
        "Set when the released Task was archived; it is no longer readable, so the summary is not navigable",
    }),
  })
  .openapi("TaskScheduleOccurrenceReleasedTask");

export const taskScheduleOccurrenceSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "Ledger row identity, also the pagination tie-breaker",
      example: "33333333-3333-7333-8333-333333333333",
    }),
    state: z
      .enum(TaskScheduleOccurrenceState)
      .openapi({ example: TaskScheduleOccurrenceState.RELEASED }),
    scheduleVersion: z.number().int().openapi({
      description:
        "1 for legacy display-only projections, 2 for epoch-backed rows",
      example: 2,
    }),
    epochId: z.string().uuid().nullable().openapi({
      description: "Rule epoch that projected this occurrence, when known",
    }),
    originalScheduledAt: dateTimeSchema.nullable().openapi({
      description:
        "Time the rule originally projected, when the ledger captured it",
    }),
    effectiveScheduledAt: dateTimeSchema.openapi({
      description: "Time the occurrence actually holds; the ordering key",
    }),
    timezone: z.string().nullable().openapi({
      description: "IANA timezone captured with the rule",
      example: "Europe/Berlin",
    }),
    isMissed: z.boolean().openapi({
      description:
        "A planned occurrence whose effective time has passed without a release. Derived server-side so clients never depend on their own clock.",
      example: false,
    }),
    sourceId: z.string().openapi({
      description: "Canonical Calendar source identity",
      example: "workspace:11111111-1111-7111-8111-111111111111",
    }),
    sourceWorkspaceId: z.string().uuid().openapi({
      description: "Workspace captured as the Calendar source",
    }),
    sourceType: z
      .enum(CalendarSourceType)
      .openapi({ example: CalendarSourceType.WORKSPACE }),
    sourceProjectId: z.string().uuid().nullable().openapi({
      description: "Project captured as the Calendar source, when applicable",
    }),
    sourceAccuracy: z
      .enum(CalendarSourceAccuracy)
      .openapi({ example: CalendarSourceAccuracy.EXACT }),
    timeAccuracy: z
      .enum(CalendarTimeAccuracy)
      .openapi({ example: CalendarTimeAccuracy.EXACT }),
    releasedTask: taskScheduleOccurrenceReleasedTaskSchema.nullable().openapi({
      description: "Independent Task this occurrence released, when it did",
    }),
  })
  .openapi("TaskScheduleOccurrence");

/**
 * The revision travels on the page rather than on each row so an empty page
 * still tells the client which series revision it observed.
 */
export const taskScheduleOccurrencePageSchema = z
  .object({
    scheduleRevision: z.number().int().nonnegative().openapi({
      description: "Series revision this page was read at",
      example: 4,
    }),
    futureExceptionCount: z.number().int().nonnegative().openapi({
      description:
        "Durable future exceptions a full-series edit or removal would cancel, counted across the whole series at this read's instant. 0 for a series with no live rule. Clients confirm a destructive discard only when this is above zero.",
      example: 0,
    }),
    occurrences: z.array(taskScheduleOccurrenceSchema),
  })
  .openapi("TaskScheduleOccurrencePage");

export type TaskScheduleOccurrencePage = z.infer<
  typeof taskScheduleOccurrencePageSchema
>;
