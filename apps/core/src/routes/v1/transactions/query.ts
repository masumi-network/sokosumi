import { z } from "@hono/zod-openapi";

import { requireTaskReadForWorkspace } from "@/helpers/access-control";

import {
  deduplicateQueryValues,
  preprocessMultiValueQueryInput,
} from "@/helpers/query-params";
import prisma from "@/lib/db/prisma";
import type { WorkspaceContext } from "@/middleware/workspace";
import { transactionHistoryKinds } from "@/schemas/transaction-history.schema";

const scopeQuerySchema = z
  .enum(["workspace", "owned"])
  .default("owned")
  .openapi({
    param: { name: "scope", in: "query" },
    description:
      "owned: only ledger rows belonging to the calling user. workspace: every ledger row in the active workspace, including organization-level ones with no user.",
    example: "workspace",
  });

const searchQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .optional()
  .openapi({
    param: { name: "q", in: "query" },
    description:
      "Case-insensitive search across the labels a row can carry: job, agent, task, coworker and image model names, task event comments, image prompts and top up bucket notes.",
    example: "onboarding",
  });

const typesQuerySchema = z
  .preprocess(
    preprocessMultiValueQueryInput,
    z
      .array(z.enum(transactionHistoryKinds))
      .min(1)
      .optional()
      .transform(deduplicateQueryValues),
  )
  .openapi({
    param: { name: "types", in: "query" },
    description:
      "Comma-separated ledger sources to include: job, image, task, coworker, sokoBot, topUp, unattributed. `topUp` are credits added to the account; every other kind takes credits. `unattributed` are spends with no entity relation at all.",
    example: "job,image",
  });

const projectIdQuerySchema = z
  .union([z.string().uuid(), z.literal("null")])
  .optional()
  .openapi({
    param: { name: "projectId", in: "query" },
    description:
      "Filter ledger rows by project. Use 'null' for rows with no project, which includes every coworker, Soko Bot, top up and unattributed row.",
    example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  });

const taskIdQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .optional()
  .openapi({
    param: { name: "taskId", in: "query" },
    description:
      "Only rows for this Task: charges by its events and its Jobs, and the refunds of those charges.",
    example: "01a1ddca-e1fd-771a-bb5e-0b40c2177dfc",
  });

/**
 * A Task filter narrows the ledger to one Task, so it reads only a Task the
 * caller may open in the active workspace: a private Task only for its owner.
 * Anything else is "Task not found", whether or not it has rows.
 */
export async function requireLedgerTaskFilter(
  workspaceContext: WorkspaceContext,
  userId: string,
  taskId: string | undefined,
): Promise<void> {
  if (taskId) {
    await requireTaskReadForWorkspace(workspaceContext, taskId, prisma, userId);
  }
}

/** The ledger filters every Transactions endpoint shares. */
export const transactionFilterQuerySchema = z.object({
  projectId: projectIdQuerySchema,
  q: searchQuerySchema,
  scope: scopeQuerySchema,
  taskId: taskIdQuerySchema,
  types: typesQuerySchema,
});

const dayQuerySchema = (name: "from" | "to", description: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
      message: "Not a calendar date",
    })
    .openapi({
      param: { name, in: "query" },
      description,
      example: "2026-09-01",
    });

/** An inclusive UTC day range. Both ends are optional on the daily chart. */
export const transactionDateRangeQuerySchema = z.object({
  from: dayQuerySchema(
    "from",
    "First day to include, as YYYY-MM-DD in UTC.",
  ).optional(),
  to: dayQuerySchema(
    "to",
    "Last day to include, as YYYY-MM-DD in UTC.",
  ).optional(),
});

const DAY_MS = 86_400_000;

/**
 * The half-open `[from, to)` instant range for an inclusive day range, so the
 * whole last day is included. Returns null when `from` is after `to`.
 */
export function toInstantRange(range: {
  from?: string;
  to?: string;
}): { from?: Date; to?: Date } | null {
  if (range.from && range.to && range.from > range.to) {
    return null;
  }

  return {
    from: range.from ? new Date(`${range.from}T00:00:00Z`) : undefined,
    to: range.to
      ? new Date(Date.parse(`${range.to}T00:00:00Z`) + DAY_MS)
      : undefined,
  };
}
