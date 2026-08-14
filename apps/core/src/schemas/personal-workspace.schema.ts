import { z } from "@hono/zod-openapi";

export const personalWorkspaceCreatedSchema = z
  .object({
    workspaceId: z.uuid().openapi({
      description: "Id of the newly created personal workspace",
      example: "11111111-1111-7111-8111-111111111111",
    }),
  })
  .openapi("PersonalWorkspaceCreated");
