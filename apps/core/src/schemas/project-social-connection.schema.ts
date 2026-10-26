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

export const projectSocialConnectionSubscriptionSchema = z
  .object({
    subscriptionType: z.string().nullable(),
    textLimit: z.number().int().positive(),
  })
  .openapi("ProjectSocialConnectionSubscription");

export const projectSocialConnectionSchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    }),
    provider: projectSocialProviderSchema,
    externalHandle: z.string().nullable().openapi({ example: "sokosumi" }),
    displayName: z.string().nullable().openapi({ example: "Sokosumi" }),
    subscriptionType: z.string().nullable().openapi({
      description: "X subscription tier; null when unknown or not X",
      example: "Premium",
    }),
    avatarUrl: z.string().url().nullable().openapi({
      description: "Profile picture copy in Sokosumi storage",
      example:
        "https://abc.public.blob.vercel-storage.com/social-avatars/p/image-x-1.jpg",
    }),
    accountType: z.enum(["personal", "organization"]).nullable().openapi({
      description:
        "LinkedIn: a personal profile or a company page. Null for other providers.",
      example: "personal",
    }),
    status: z
      .enum(["pending", "active", "reauthorization_required", "disconnected"])
      .openapi({ example: "active" }),
    connectedAt: dateTimeSchema.nullable(),
    disconnectedAt: dateTimeSchema.nullable(),
  })
  .openapi("ProjectSocialConnection");

export const projectSocialConnectionPageSchema = z
  .object({
    externalAccountId: z.string().min(1).openapi({
      description: "Provider id of the page; send it back to add the page",
      example: "urn:li:organization:123456",
    }),
    name: z.string().nullable().openapi({ example: "Example Company" }),
    handle: z.string().nullable().openapi({ example: "example-company" }),
    logoUrl: z.string().url().nullable().openapi({
      description: "Provider CDN logo URL; it expires, so do not store it",
    }),
    socialConnectionId: z.string().uuid().nullable().openapi({
      description: "The Project account for this page, when already added",
    }),
  })
  .openapi("ProjectSocialConnectionPage");

export const projectSocialConnectionPagesSchema = z
  .object({
    status: z.enum(["available", "permission_missing"]).openapi({
      description:
        "`permission_missing`: the connection was authorized without the provider permission to manage pages. Personal posting still works.",
      example: "available",
    }),
    pages: z.array(projectSocialConnectionPageSchema),
  })
  .openapi("ProjectSocialConnectionPages");

export const addProjectSocialConnectionPageRequestSchema = z
  .object({
    externalAccountId: z.string().min(1).max(200).openapi({
      example: "urn:li:organization:123456",
    }),
  })
  .openapi("AddProjectSocialConnectionPageRequest");

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
