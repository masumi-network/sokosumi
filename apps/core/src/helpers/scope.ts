import { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";

import type { UserAuthenticationContext } from "@/middleware/auth";

import {
  deduplicateQueryValues,
  preprocessMultiValueQueryInput,
} from "./query-params";

export const DEFAULT_SCOPE = "context" as const;

export const TASK_SCOPE_VALUES = ["context", "owned"] as const;
export const JOB_SCOPE_VALUES = ["context", "owned"] as const;

export type TaskScope = (typeof TASK_SCOPE_VALUES)[number];
export type JobScope = (typeof JOB_SCOPE_VALUES)[number];

function deduplicateScopes<T extends string>(
  scopes: readonly T[] | undefined,
): T[] {
  if (!scopes || scopes.length === 0) {
    return [DEFAULT_SCOPE as T];
  }

  return deduplicateQueryValues(scopes) ?? [DEFAULT_SCOPE as T];
}

export function buildTaskScopeFilters(
  authContext: UserAuthenticationContext,
  scopes: readonly TaskScope[] | undefined,
): Prisma.TaskWhereInput[] {
  const uniqueScopes = new Set(deduplicateScopes(scopes));
  const filters: Prisma.TaskWhereInput[] = [];

  if (uniqueScopes.has("context")) {
    filters.push({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
    });
  }

  if (uniqueScopes.has("owned")) {
    filters.push({
      userId: authContext.userId,
    });
  }

  return filters;
}

export function buildJobScopeFilters(
  authContext: UserAuthenticationContext,
  scopes: readonly JobScope[] | undefined,
): Prisma.JobWhereInput[] {
  const uniqueScopes = new Set(deduplicateScopes(scopes));
  const filters: Prisma.JobWhereInput[] = [];

  if (uniqueScopes.has("context")) {
    filters.push({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
    });
  }

  if (uniqueScopes.has("owned")) {
    filters.push({
      userId: authContext.userId,
    });
  }

  return filters;
}

const taskScopeArraySchema = z
  .array(z.enum(TASK_SCOPE_VALUES))
  .min(1)
  .optional();
const jobScopeArraySchema = z.array(z.enum(JOB_SCOPE_VALUES)).min(1).optional();

export const taskScopeQuerySchema = z
  .preprocess(preprocessMultiValueQueryInput, taskScopeArraySchema)
  .openapi({
    param: { name: "scope", in: "query" },
    description:
      "Comma-separated scope filters. Allowed values: context, owned. Example: context,owned",
    example: "context",
  });

export const jobScopeQuerySchema = z
  .preprocess(preprocessMultiValueQueryInput, jobScopeArraySchema)
  .openapi({
    param: { name: "scope", in: "query" },
    description:
      "Comma-separated scope filters. Allowed values: context, owned. Example: context,owned",
    example: "context",
  });
