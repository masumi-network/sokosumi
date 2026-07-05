import { z } from "@hono/zod-openapi";
import { CoworkerGrantScope, CoworkerGrantStatus } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime";

export const coworkerGrantScopeSchema = z
  .enum([
    CoworkerGrantScope.TASK_READ,
    CoworkerGrantScope.TASK_COMMENT,
    CoworkerGrantScope.TASK_CREATE,
  ])
  .openapi("CoworkerGrantScope");

export const coworkerGrantStatusSchema = z
  .enum([
    CoworkerGrantStatus.PENDING,
    CoworkerGrantStatus.GRANTED,
    CoworkerGrantStatus.DENIED,
    CoworkerGrantStatus.REVOKED,
  ])
  .openapi("CoworkerGrantStatus");

export const coworkerGrantSchema = z
  .object({
    id: z.string().openapi({ example: "grant_123" }),
    scope: coworkerGrantScopeSchema,
    status: coworkerGrantStatusSchema,
    createdAt: dateTimeSchema,
    resolvedAt: dateTimeSchema.nullable(),
    coworker: z.object({
      id: z.string().openapi({ example: "cow_123" }),
      slug: z.string().openapi({ example: "hermes" }),
      name: z.string().openapi({ example: "Hermes" }),
      image: z.string().nullable().openapi({
        example: "https://example.com/hermes.png",
      }),
    }),
  })
  .openapi("CoworkerGrant");

export const coworkerGrantListSchema = z
  .array(coworkerGrantSchema)
  .openapi("CoworkerGrantList");

/**
 * Target statuses a user may set: approve a request (GRANTED), turn one
 * down (DENIED), or withdraw earlier consent (REVOKED). PENDING is
 * system-set only, on the coworker's request.
 */
export const resolveCoworkerGrantRequestSchema = z
  .object({
    status: z.enum([
      CoworkerGrantStatus.GRANTED,
      CoworkerGrantStatus.DENIED,
      CoworkerGrantStatus.REVOKED,
    ]),
  })
  .openapi("ResolveCoworkerGrantRequest");
