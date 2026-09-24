import { z } from "@hono/zod-openapi";
import { isValidTimezone, SOCIAL_POST_TEXT_LIMITS } from "@sokosumi/utils";
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

const socialPostTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(SOCIAL_POST_TEXT_LIMITS.x)
  .openapi({ example: "Shipping the new Calendar today." });

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
    revision: z.number().int().min(0).openapi({ example: 2 }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    canEdit: z.boolean(),
    canSchedule: z.boolean(),
    canCancel: z.boolean(),
  })
  .openapi("SocialPost");

export const createSocialPostRequestSchema = z
  .object({
    text: socialPostTextSchema,
    socialConnectionId: z.string().uuid().optional(),
    scheduledAt: dateTimeSchema.optional(),
    timezone: socialPostTimezoneSchema.optional(),
  })
  .openapi("CreateSocialPostRequest");

export const updateSocialPostRequestSchema = z
  .object({
    text: socialPostTextSchema.optional(),
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
