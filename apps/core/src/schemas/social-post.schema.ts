import { z } from "@hono/zod-openapi";
import {
  isValidTimezone,
  SOCIAL_POST_MEDIA_RULES,
  SOCIAL_POST_TEXT_LIMITS,
} from "@sokosumi/utils";

import { dateTimeSchema } from "@/helpers/datetime";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import {
  projectSocialConnectionProjectParamsSchema,
  projectSocialConnectionSchema,
} from "@/schemas/project-social-connection.schema";

export const SOCIAL_POST_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "MISSED",
  "CANCELED",
] as const;

export const socialPostProjectParamsSchema =
  projectSocialConnectionProjectParamsSchema;

export const socialPostParamsSchema = socialPostProjectParamsSchema.extend({
  postId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "postId", in: "path" },
      example: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    }),
});

export const socialPostStatusSchema = z
  .enum(SOCIAL_POST_STATUSES)
  .openapi("SocialPostStatus");

/** Text may be empty when media is attached; the service enforces the combination. */
const socialPostTextSchema = z
  .string()
  .trim()
  .max(SOCIAL_POST_TEXT_LIMITS.x)
  .openapi({ example: "Shipping the new Calendar today." });

export const socialPostMediaRefSchema = z
  .object({
    pathname: z.string().min(1).openapi({
      example: "drive/users/user_123/launch.png",
      description: "Drive blob pathname; must belong to the active workspace",
    }),
    fileUrl: z.string().url().openapi({
      example:
        "https://store.public.blob.vercel-storage.com/drive/users/user_123/launch.png",
      description: "Public Blob URL of the Drive file",
    }),
    name: z.string().min(1).openapi({ example: "launch.png" }),
    size: z.number().int().min(0).openapi({ example: 240000 }),
    mimeType: z.string().min(1).openapi({ example: "image/png" }),
    kind: z.enum(["image", "gif", "video"]).openapi({ example: "image" }),
  })
  .openapi("SocialPostMediaRef");

const socialPostMediaRequestSchema = z
  .array(socialPostMediaRefSchema)
  .max(SOCIAL_POST_MEDIA_RULES.x.maxImages)
  .openapi({
    description:
      "Drive files to attach: up to 4 images, or 1 GIF, or 1 video. Never mixed.",
  });

const socialPostTimezoneSchema = z
  .string()
  .refine((value) => isValidTimezone(value), {
    message: "timezone must be a valid IANA time zone",
  })
  .openapi({ example: "Europe/Zurich" });

const socialPostRevisionSchema = z.number().int().min(0).openapi({
  description: "Revision the client last observed; mismatches return 409",
  example: 2,
});

export const socialPostSocialConnectionSchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    }),
    externalHandle: z.string().nullable().openapi({ example: "sokosumi" }),
    status: projectSocialConnectionSchema.shape.status,
  })
  .openapi("SocialPostSocialConnection");

export const socialPostCreatorSchema = z
  .object({
    kind: z.enum(["user", "coworker", "sokoBot"]).openapi({ example: "user" }),
    id: z.string().openapi({ example: "user_123" }),
    name: z.string().nullable().openapi({ example: "Ada Lovelace" }),
  })
  .openapi("SocialPostCreator");

export const socialPostLastAttemptSchema = z
  .object({
    attempt: z.number().int().min(1).openapi({ example: 1 }),
    trigger: z.enum(["scheduler", "publish_now"]),
    outcome: z
      .enum([
        "succeeded",
        "failed_transient",
        "failed_permanent",
        "missed",
        "connection_inactive",
      ])
      .nullable(),
    errorKind: z.string().nullable().openapi({ example: "rate_limited" }),
    providerOutcome: z.string().nullable(),
    finishedAt: dateTimeSchema.nullable(),
  })
  .openapi("SocialPostLastAttempt");

export const socialPostSchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    }),
    projectId: z.string().uuid().openapi({
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
    provider: z.literal("x"),
    text: z.string(),
    media: z.array(socialPostMediaRefSchema),
    status: socialPostStatusSchema,
    scheduledAt: dateTimeSchema.nullable(),
    timezone: z.string().nullable().openapi({ example: "Europe/Zurich" }),
    socialConnection: socialPostSocialConnectionSchema.nullable(),
    creator: socialPostCreatorSchema,
    scheduledByUserId: z.string().nullable(),
    canceledAt: dateTimeSchema.nullable(),
    publishedAt: dateTimeSchema.nullable(),
    publishedExternalId: z.string().nullable(),
    publishedUrl: z.string().nullable(),
    lastError: z.string().nullable(),
    attemptCount: z.number().int().min(0).openapi({ example: 0 }),
    nextAttemptAt: dateTimeSchema.nullable(),
    lastAttemptAt: dateTimeSchema.nullable(),
    // Keep the named component non-null so generated date transformers guard it.
    lastAttempt: z.union([socialPostLastAttemptSchema, z.null()]),
    revision: z.number().int().min(0).openapi({ example: 2 }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    canEdit: z.boolean(),
    canSchedule: z.boolean(),
    canCancel: z.boolean(),
    canPublishNow: z.boolean(),
    connectionNeedsReconnect: z.boolean().openapi({
      description:
        "The linked connection exists but is not active, so the post cannot go out until someone reconnects",
    }),
  })
  .openapi("SocialPost");

/** Text may be empty when media is attached; at least one of the two is required. */
function hasTextOrMedia(value: {
  text?: string;
  media?: readonly unknown[];
}): boolean {
  return (value.text?.trim().length ?? 0) > 0 || (value.media?.length ?? 0) > 0;
}

export const createSocialPostRequestSchema = z
  .object({
    text: socialPostTextSchema,
    media: socialPostMediaRequestSchema.optional(),
    socialConnectionId: z.string().uuid().optional(),
    scheduledAt: dateTimeSchema.optional(),
    timezone: socialPostTimezoneSchema.optional(),
  })
  .refine(hasTextOrMedia, { message: "Text or media is required" })
  .openapi("CreateSocialPostRequest");

// No text-or-media refine here: the rule depends on media already stored on
// the post, which the request body cannot see. The service enforces it.
export const updateSocialPostRequestSchema = z
  .object({
    text: socialPostTextSchema.optional(),
    media: socialPostMediaRequestSchema.optional(),
    socialConnectionId: z.string().uuid().nullable().optional(),
    revision: socialPostRevisionSchema,
  })
  .openapi("UpdateSocialPostRequest");

export const scheduleSocialPostRequestSchema = z
  .object({
    scheduledAt: dateTimeSchema,
    timezone: socialPostTimezoneSchema.optional(),
    socialConnectionId: z.string().uuid().optional(),
    revision: socialPostRevisionSchema,
  })
  .openapi("ScheduleSocialPostRequest");

export const cancelSocialPostRequestSchema = z
  .object({
    revision: socialPostRevisionSchema,
  })
  .openapi("CancelSocialPostRequest");

export const publishSocialPostRequestSchema = z
  .object({
    revision: socialPostRevisionSchema,
  })
  .openapi("PublishSocialPostRequest");

function isSocialPostStatus(
  value: string,
): value is (typeof SOCIAL_POST_STATUSES)[number] {
  return (SOCIAL_POST_STATUSES as readonly string[]).includes(value);
}

export const listSocialPostsQuerySchema = cursorPaginationQuerySchema.extend({
  cursor: z
    .string()
    .uuid()
    .optional()
    .openapi({
      param: { name: "cursor", in: "query" },
      description: "UUID of the last Social post from the previous page",
      example: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    }),
  status: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) {
        return undefined;
      }
      const statuses = value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      const unknown = statuses.filter((entry) => !isSocialPostStatus(entry));
      if (statuses.length === 0 || unknown.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: `status must be a comma-separated list of ${SOCIAL_POST_STATUSES.join(", ")}`,
        });
        return z.NEVER;
      }
      return statuses.filter(isSocialPostStatus);
    })
    .openapi({
      param: { name: "status", in: "query" },
      description: "Comma-separated Social post statuses to include",
      example: "DRAFT,SCHEDULED",
    }),
});
