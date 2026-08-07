import { z } from "@hono/zod-openapi";
import { CoworkerWorkspaceAccessStatus } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const coworkerWorkspaceAccessStatusSchema = z
  .enum(CoworkerWorkspaceAccessStatus)
  .openapi({ example: CoworkerWorkspaceAccessStatus.PENDING });

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

/** Body for create and platform force-revoke (workspaceId only). */
export const coworkerWorkspaceAccessWorkspaceIdBodySchema = z.object({
  workspaceId: z.string().uuid(),
});
