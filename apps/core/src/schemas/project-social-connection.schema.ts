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

export const tikTokCreatorInfoSchema = z
  .object({
    creator_nickname: z.string().min(1),
    privacy_level_options: z.array(z.string()),
    comment_disabled: z.boolean(),
    duet_disabled: z.boolean(),
    stitch_disabled: z.boolean(),
    max_video_post_duration_sec: z.number().int().positive(),
  })
  .openapi("TikTokCreatorInfo");

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
    status: z
      .enum(["pending", "active", "reauthorization_required", "disconnected"])
      .openapi({ example: "active" }),
    connectedAt: dateTimeSchema.nullable(),
    disconnectedAt: dateTimeSchema.nullable(),
    personalProfile: z.boolean().openapi({
      description:
        "A LinkedIn connection that posts as the person, not as a company Page.",
    }),
  })
  .openapi("ProjectSocialConnection");

export const disconnectProjectSocialConnectionResponseSchema =
  projectSocialConnectionSchema
    .extend({
      providerRevocation: z.enum(["succeeded", "failed", "skipped"]),
    })
    .openapi("DisconnectProjectSocialConnectionResponse");

const socialConnectionCallbackUrlSchema = z.url().max(2048).optional().openapi({
  description:
    "Where the provider sends the person back: a page of a first-party app (Sokosumi or CMO.xyz). Defaults to Sokosumi's popup callback.",
  example: "https://app.cmo.xyz/connect/callback",
});

const accountChoiceSchema = z.boolean().optional().openapi({
  description:
    "The caller lets the person pick the account the sign-in connects (finalize with `offerChoice`). Where company Pages are open, LinkedIn then signs in through a provider that reaches the person's Pages.",
});

export const initiateProjectSocialConnectionRequestSchema = z
  .discriminatedUnion("action", [
    z.object({
      action: z.literal("connect"),
      provider: projectSocialProviderSchema,
      callbackUrl: socialConnectionCallbackUrlSchema,
      accountChoice: accountChoiceSchema,
    }),
    z.object({
      action: z.literal("reconnect"),
      socialConnectionId: z.string().uuid(),
      callbackUrl: socialConnectionCallbackUrlSchema,
      accountChoice: accountChoiceSchema,
    }),
    z.object({
      action: z.literal("replace"),
      socialConnectionId: z.string().uuid(),
      callbackUrl: socialConnectionCallbackUrlSchema,
      accountChoice: accountChoiceSchema,
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
    callbackProof: z.string().min(1).max(256).optional().openapi({
      description: "Proof returned with a Zernio connection callback.",
    }),
    connectionId: z.string().min(1).openapi({ example: "ca_123" }),
    pendingDataToken: z.string().min(1).max(512).optional().openapi({
      description:
        "Returned with a LinkedIn sign-in that waits for its account: names the Pages it reaches.",
    }),
    connectToken: z.string().min(1).max(4096).optional().openapi({
      description:
        "Returned with a LinkedIn sign-in that waits for its account: lets Core finish it.",
    }),
    accountChoiceId: z.string().min(1).max(64).optional().openapi({
      description:
        "The `id` of the account the person picked among the sign-in's accounts (`SocialAccountChoices`).",
    }),
    offerChoice: z.boolean().optional().openapi({
      description:
        "Answer 200 with the accounts to pick from when the sign-in reaches several and none is picked. Without it such a sign-in is refused, or LinkedIn connects the person's profile.",
    }),
  })
  .openapi("FinalizeProjectSocialConnectionRequest");

export const socialAccountChoiceSchema = z
  .object({
    id: z.string().openapi({
      description:
        "Names this account within this sign-in only; send it back as `accountChoiceId`.",
    }),
    name: z.string(),
    handle: z.string().nullable(),
    kind: z.enum(["page", "profile"]),
  })
  .openapi("SocialAccountChoice");

export const socialAccountChoicesSchema = z
  .object({
    choices: z.array(socialAccountChoiceSchema).min(2),
  })
  .openapi("SocialAccountChoices");
