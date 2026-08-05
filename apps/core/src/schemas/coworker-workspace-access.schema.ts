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

export const createCoworkerWorkspaceAccessRequestSchema = z.object({
  workspaceId: z.string().uuid(),
});
