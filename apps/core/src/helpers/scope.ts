import { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";

import type { UserAuthenticationContext } from "@/middleware/auth";

export const DEFAULT_SCOPE = "context" as const;

export const TASK_SCOPE_VALUES = ["context", "owned"] as const;
export const JOB_SCOPE_VALUES = ["context", "owned", "shared"] as const;

export type TaskScope = (typeof TASK_SCOPE_VALUES)[number];
export type JobScope = (typeof JOB_SCOPE_VALUES)[number];

export function preprocessMultiValueQueryInput(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  const rawValues = Array.isArray(value) ? value : [value];
  if (!rawValues.every((rawValue) => typeof rawValue === "string")) {
    return value;
  }

  return rawValues.flatMap((rawValue) =>
    rawValue.split(",").map((token) => token.trim()),
  );
}

export function deduplicateQueryValues<T extends string>(
  values: readonly T[] | undefined,
): T[] | undefined {
  if (!values) {
    return undefined;
  }

  return Array.from(new Set(values));
}

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

  if (uniqueScopes.has("shared") && authContext.organizationId) {
    filters.push({
      share: {
        organizationId: authContext.organizationId,
      },
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
      "Comma-separated scope filters. Allowed values: context, owned, shared. Example: context,shared",
    example: "context",
  });
