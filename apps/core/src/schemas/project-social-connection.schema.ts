import { z } from "@hono/zod-openapi";

import {
  PROJECT_SOCIAL_PROVIDERS,
  type ProjectSocialProvider,
} from "@/config/social-providers";
import { dateTimeSchema } from "@/helpers/datetime";

export const projectSocialProviderSchema = z
  .enum(Object.keys(PROJECT_SOCIAL_PROVIDERS) as ProjectSocialProvider[])
  .openapi("ProjectSocialProvider", { example: "x" });

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
    provider: projectSocialProviderSchema,
    externalHandle: z.string().nullable().openapi({ example: "sokosumi" }),
    displayName: z.string().nullable().openapi({ example: "Sokosumi" }),
    avatarUrl: z.string().url().nullable().openapi({
      description: "Profile picture copy in Sokosumi storage",
      example:
        "https://abc.public.blob.vercel-storage.com/social-avatars/p/image-x-1.jpg",
    }),
    status: z
      .enum(["pending", "active", "reauthorization_required", "disconnected"])
      .openapi({ example: "active" }),
    connectedAt: dateTimeSchema.nullable(),
    disconnectedAt: dateTimeSchema.nullable(),
  })
  .openapi("ProjectSocialConnection");

export const disconnectProjectSocialConnectionResponseSchema =
  projectSocialConnectionSchema
    .extend({
      providerRevocation: z.enum(["succeeded", "failed", "skipped"]),
    })
    .openapi("DisconnectProjectSocialConnectionResponse");

export const initiateProjectSocialConnectionRequestSchema = z
  .discriminatedUnion("action", [
    z.object({
      action: z.literal("connect"),
      provider: projectSocialProviderSchema,
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
