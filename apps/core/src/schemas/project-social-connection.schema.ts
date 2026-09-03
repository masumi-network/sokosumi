import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

export const projectSocialConnectionProjectParamsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
});

export const projectSocialConnectionParamsSchema =
  projectSocialConnectionProjectParamsSchema.extend({
    connectionId: z
      .string()
      .uuid()
      .openapi({
        param: { name: "connectionId", in: "path" },
        example: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      }),
  });

export const projectSocialConnectionSchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    }),
    provider: z.literal("x"),
    externalHandle: z.string().nullable().openapi({ example: "sokosumi" }),
    status: z
      .enum(["pending", "active", "reauthorization_required", "disconnected"])
      .openapi({ example: "active" }),
    connectedAt: dateTimeSchema.nullable(),
    disconnectedAt: dateTimeSchema.nullable(),
  })
  .openapi("ProjectSocialConnection");

export const initiateProjectSocialConnectionRequestSchema = z
  .discriminatedUnion("action", [
    z.object({
      action: z.literal("connect"),
      provider: z.literal("x"),
    }),
    z.object({
      action: z.literal("reconnect"),
      socialConnectionId: z.string().uuid(),
    }),
    z.object({
      action: z.literal("replace"),
      socialConnectionId: z.string().uuid(),
    }),
  ])
  .openapi("InitiateProjectSocialConnectionRequest");

export const initiateProjectSocialConnectionResponseSchema = z
  .object({
    connectionId: z.string().min(1).openapi({ example: "ca_123" }),
    redirectUrl: z.url().openapi({
      example: "https://connect.composio.dev/link-token",
    }),
  })
  .openapi("InitiateProjectSocialConnectionResponse");

export const finalizeProjectSocialConnectionRequestSchema = z
  .object({
    connectionId: z.string().min(1).openapi({ example: "ca_123" }),
  })
  .openapi("FinalizeProjectSocialConnectionRequest");
