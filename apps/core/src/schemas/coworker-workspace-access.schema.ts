import { z } from "@hono/zod-openapi";
import { CoworkerWorkspaceAccessStatus } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const coworkerWorkspaceAccessStatusSchema = z
  .enum(CoworkerWorkspaceAccessStatus)
  .openapi({ example: CoworkerWorkspaceAccessStatus.PENDING });

export const coworkerWorkspaceAccessWorkspaceKindSchema = z
  .enum(["user", "organization"])
  .openapi({ example: "organization" });

export const coworkerWorkspaceAccessSchema = z
  .object({
    id: z
      .string()
      .uuid()
      .openapi({ example: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    coworkerId: z.string().uuid(),
    coworkerName: z.string().openapi({ example: "Ops Pilot" }),
    coworkerSlug: z.string().openapi({ example: "ops-pilot" }),
    workspaceId: z.string().uuid(),
    /** Personal vs organization workspace. */
    workspaceKind: coworkerWorkspaceAccessWorkspaceKindSchema,
    /** User name or organization name. */
    workspaceDisplayName: z.string().openapi({ example: "Acme Corp" }),
    /** User email or organization slug. */
    workspaceDisplayDetail: z.string().openapi({ example: "acme-corp" }),
    status: coworkerWorkspaceAccessStatusSchema,
    requestedByUserId: z.string().nullable(),
    resolvedAt: dateTimeSchema.nullable(),
    resolvedById: z.string().nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("CoworkerWorkspaceAccess");

export const coworkerWorkspaceAccessesSchema = z.array(
  coworkerWorkspaceAccessSchema,
);

export type CoworkerWorkspaceAccessDto = z.infer<
  typeof coworkerWorkspaceAccessSchema
>;

/**
 * Target for create and platform force-revoke.
 * Exactly one of: workspaceId, userId, organizationId, email (personal),
 * or organizationSlug (org workspace).
 */
export const coworkerWorkspaceAccessWorkspaceIdBodySchema = z
  .object({
    workspaceId: z.string().uuid().optional().openapi({
      description: "Existing workspace id (raw target).",
    }),
    userId: z.string().min(1).optional().openapi({
      description:
        "User id — resolves (or creates) that user's personal workspace.",
    }),
    organizationId: z.string().min(1).optional().openapi({
      description: "Organization id — resolves (or creates) the org workspace.",
    }),
    email: z.string().email().optional().openapi({
      description:
        "User email — resolves (or creates) that user's personal workspace. Prefer for vendor targeting without directory search.",
      example: "pilot@example.com",
    }),
    organizationSlug: z.string().min(1).optional().openapi({
      description:
        "Organization slug — resolves (or creates) the org workspace. Prefer for vendor targeting without directory search.",
      example: "acme-corp",
    }),
  })
  .superRefine((value, ctx) => {
    const provided = [
      value.workspaceId != null && value.workspaceId.length > 0,
      value.userId != null && value.userId.length > 0,
      value.organizationId != null && value.organizationId.length > 0,
      value.email != null && value.email.length > 0,
      value.organizationSlug != null && value.organizationSlug.length > 0,
    ].filter(Boolean).length;

    if (provided !== 1) {
      ctx.addIssue({
        code: "custom",
        message:
          "Provide exactly one of workspaceId, userId, organizationId, email, or organizationSlug",
      });
    }
  })
  .openapi("CoworkerWorkspaceAccessTarget");

export type CoworkerWorkspaceAccessTargetBody = z.infer<
  typeof coworkerWorkspaceAccessWorkspaceIdBodySchema
>;
