import { z } from "@hono/zod-openapi";
import {
  isValidTimezone,
  SOCIAL_POST_FIRST_COMMENT_MAX,
  SOCIAL_POST_MEDIA_MAX,
  SOCIAL_POST_TEXT_LIMITS,
  SOCIAL_POST_TEXT_MAX,
  type SocialPostProvider,
} from "@sokosumi/utils";
import { dateTimeSchema } from "@/helpers/datetime";
import { SOCIAL_POST_THREAD_MAX_PARTS } from "@/helpers/social-post-thread";
import { driveFileRefShape } from "@/schemas/drive-file-ref.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import {
  projectSocialConnectionProjectParamsSchema,
  projectSocialConnectionSchema,
} from "@/schemas/project-social-connection.schema";
import { socialPostStatisticsSchema } from "@/schemas/social-post-statistics.schema";

const SOCIAL_POST_PROVIDER_KEYS = Object.keys(SOCIAL_POST_TEXT_LIMITS) as [
  SocialPostProvider,
  ...SocialPostProvider[],
];

export const socialPostProviderSchema = z.enum(SOCIAL_POST_PROVIDER_KEYS);

export const SOCIAL_POST_STATUSES = [
  "DRAFT",
  "NEEDS_APPROVAL",
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
  .max(SOCIAL_POST_TEXT_MAX)
  .openapi({ example: "Shipping the new Calendar today." });

const socialPostFirstCommentSchema = z
  .string()
  .trim()
  .max(SOCIAL_POST_FIRST_COMMENT_MAX)
  .openapi({
    example: "#launch",
    description:
      "Posted after publishing succeeds. For X threads, replies to the last thread part.",
  });

export const socialPostMediaRefSchema = z
  .object({
    ...driveFileRefShape,
    size: z.number().int().min(0).openapi({ example: 240000 }),
    mimeType: z.string().min(1).openapi({ example: "image/png" }),
    kind: z.enum(["image", "gif", "video"]).openapi({ example: "image" }),
  })
  .openapi("SocialPostMediaRef");

const socialPostMediaRequestSchema = z
  .array(socialPostMediaRefSchema)
  .max(SOCIAL_POST_MEDIA_MAX)
  .openapi({
    description:
      "Drive files to attach: up to four images, or one video, according to the provider's rules. Never mixed.",
  });

const socialPostThreadPartRequestSchema = z.object({
  text: socialPostTextSchema,
  media: socialPostMediaRequestSchema.optional(),
});

const socialPostThreadPartsRequestSchema = z
  .array(socialPostThreadPartRequestSchema)
  .max(SOCIAL_POST_THREAD_MAX_PARTS - 1)
  .openapi({
    description:
      "Additional X-only parts in order. At most 25 posts including the main text/media. Every part uses the main post's text and media rules. Posts target exactly one account; non-X targets return 400. An empty list removes the parts. Editing is blocked once any part has been published or its outcome is unconfirmed.",
  });

export const socialPostThreadPartSchema = z
  .object({
    id: z.uuid(),
    position: z.number().int().min(2).max(SOCIAL_POST_THREAD_MAX_PARTS),
    text: z.string(),
    media: z.array(socialPostMediaRefSchema),
    externalPostId: z.string().nullable(),
    publishedAt: dateTimeSchema.nullable(),
    error: z.string().nullable(),
  })
  .openapi("SocialPostThreadPart");

export const socialPostThreadSummaryShape = {
  threadPartCount: z.number().int().min(1).openapi({
    description:
      "Total posts including the main text/media (1 for a single post).",
  }),
  publishedThreadPartCount: z.number().int().min(0),
  failedThreadPartPosition: z.number().int().min(1).nullable(),
  partiallyPublished: z.boolean().openapi({
    description:
      "Some but not all thread parts have confirmed X ids. Terminal failures retain FAILED; retry resumes unpublished parts.",
  }),
};

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
    displayName: projectSocialConnectionSchema.shape.displayName,
    avatarUrl: projectSocialConnectionSchema.shape.avatarUrl,
    status: projectSocialConnectionSchema.shape.status,
  })
  .openapi("SocialPostSocialConnection");

export const socialPostQuotedPostSchema = z
  .object({
    id: z.uuid(),
    provider: z.literal("x"),
    status: socialPostStatusSchema,
    scheduledAt: dateTimeSchema.nullable(),
    timezone: z.string().nullable(),
    publishedExternalId: z.string().nullable(),
    publishedUrl: z.string().nullable(),
    account: z.union([socialPostSocialConnectionSchema, z.null()]),
    text: z.string(),
    media: z.array(socialPostMediaRefSchema).max(1),
  })
  .openapi("SocialPostQuotedPost");

export const socialPostQuoteSummaryShape = {
  quotedPostId: z.uuid().nullable(),
  quotedPost: z.union([socialPostQuotedPostSchema, z.null()]),
  needsAttentionReason: z.string().nullable().openapi({
    description:
      "Quote dependency failure. A queued post becomes FAILED; drafts retain approval requirements. Pick another post, remove the quote, or retry after a failed target recovers.",
  }),
};

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
        "authorization_revoked",
        "project_closed",
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
    provider: socialPostProviderSchema,
    text: z.string(),
    firstComment: z.string().nullable(),
    media: z.array(socialPostMediaRefSchema),
    ...socialPostQuoteSummaryShape,
    threadParts: z.array(socialPostThreadPartSchema),
    ...socialPostThreadSummaryShape,
    status: socialPostStatusSchema,
    scheduledAt: dateTimeSchema.nullable(),
    timezone: z.string().nullable().openapi({ example: "Europe/Zurich" }),
    socialConnection: z.union([socialPostSocialConnectionSchema, z.null()]),
    creator: socialPostCreatorSchema,
    scheduledByUserId: z.string().nullable(),
    scheduledByCoworkerId: z.string().nullable().optional().openapi({
      description:
        "Coworker that scheduled the post on behalf of scheduledByUserId, or null for a human.",
    }),
    canceledAt: dateTimeSchema.nullable(),
    publishedAt: dateTimeSchema.nullable(),
    publishedExternalId: z.string().nullable(),
    publishedUrl: z.string().nullable(),
    statistics: socialPostStatisticsSchema.nullable().optional(),
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
    canApprove: z.boolean(),
    canReject: z.boolean(),
    canDuplicate: z.boolean().openapi({
      description:
        "True when the post can be copied into a new draft (published, failed, or missed)",
    }),
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
    firstComment: socialPostFirstCommentSchema.optional(),
    media: socialPostMediaRequestSchema.optional(),
    threadParts: socialPostThreadPartsRequestSchema.optional(),
    quotedPostId: z.uuid().nullable().optional().openapi({
      description:
        "Another X post in the same project. Only the thread's first part quotes it. Until its X id is confirmed, schedule strictly after its scheduledAt; publish now is unavailable.",
    }),
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
    firstComment: socialPostFirstCommentSchema.optional(),
    media: socialPostMediaRequestSchema.optional(),
    threadParts: socialPostThreadPartsRequestSchema.optional(),
    quotedPostId: z.uuid().nullable().optional().openapi({
      description:
        "Set a quote target, or null to remove the quote and its attention reason. Also editable on a FAILED quote before any thread part has published.",
    }),
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

export const approveSocialPostRequestSchema = z
  .object({
    revision: socialPostRevisionSchema,
  })
  .openapi("ApproveSocialPostRequest");

export const rejectSocialPostRequestSchema = z
  .object({
    revision: socialPostRevisionSchema,
  })
  .openapi("RejectSocialPostRequest");

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
  provider: socialPostProviderSchema.optional(),
  quoteCandidates: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true"))
    .openapi({
      description:
        "List X posts in SCHEDULED, NEEDS_APPROVAL, or PUBLISHED, newest created first. Combine with excludePostId and search for the quote picker.",
    }),
  excludePostId: z.uuid().optional(),
  search: z
    .string()
    .trim()
    .max(500)
    .optional()
    .openapi({ description: "Case-insensitive text search" }),
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
