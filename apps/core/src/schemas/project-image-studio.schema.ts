import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

export const IMAGE_JOB_STATUSES = [
  "PENDING",
  "SUBMITTING",
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "SUBMISSION_UNCERTAIN",
  "ORPHANED",
] as const;

export const IMAGE_ASPECT_RATIOS = [
  "1:1",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "3:2",
  "2:3",
] as const;

export const IMAGE_RESOLUTIONS = ["0.5K", "1K", "2K"] as const;
export const IMAGE_OUTPUT_FORMATS = ["png", "jpeg", "webp"] as const;

export const imageStudioProjectParamsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
});

export const imageStudioAssetParamsSchema =
  imageStudioProjectParamsSchema.extend({
    assetId: z
      .string()
      .uuid()
      .openapi({
        param: { name: "assetId", in: "path" },
        example: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
  });

export const imageStudioJobParamsSchema = imageStudioProjectParamsSchema.extend(
  {
    jobId: z
      .string()
      .uuid()
      .openapi({
        param: { name: "jobId", in: "path" },
        example: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }),
  },
);

export const imageStudioSettingsSchema = z
  .object({
    aspectRatio: z.enum(IMAGE_ASPECT_RATIOS).default("1:1"),
    resolution: z.enum(IMAGE_RESOLUTIONS).default("1K"),
    outputFormat: z.enum(IMAGE_OUTPUT_FORMATS).default("png"),
    seed: z.number().int().min(0).max(2_147_483_647).nullable().default(null),
  })
  .openapi("ProjectImageSettings");

export const imageStudioReviewSchema = z
  .object({
    decision: z.enum(["APPROVED", "REJECTED"]),
    feedback: z.string().nullable(),
    decidedAt: dateTimeSchema,
    decidedByUserId: z.string(),
  })
  .openapi("ProjectImageReview");

export const imageStudioAssetSchema = z
  .object({
    id: z.string().uuid(),
    rootId: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    version: z.number().int().min(1),
    prompt: z.string(),
    model: z.string(),
    width: z.number().int().min(0),
    height: z.number().int().min(0),
    bytes: z.number().int().min(0),
    contentType: z.string(),
    createdAt: dateTimeSchema,
    jobId: z.string().uuid(),
    /**
     * The provider input this version was made with, so a variation can be
     * asked for on the same terms. Without it the client had to guess, and a
     * landscape 2K original quietly came back square and 1K.
     */
    settings: imageStudioSettingsSchema,
    /**
     * Where the bytes are served from. Always a Core route: the stored object
     * is private and has no URL a client could fetch directly.
     */
    contentPath: z.string(),
    /**
     * Absent until somebody decides. Optional rather than nullable on purpose:
     * the OpenAPI client generator emits an unguarded date transform for a
     * nullable object, which crashes on `null`, but guards an optional one. A
     * new version has no review, so that path is the common case, not an edge.
     */
    review: imageStudioReviewSchema.optional(),
  })
  .openapi("ProjectImageAsset");

export const imageStudioJobSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(IMAGE_JOB_STATUSES),
    kind: z.enum(["GENERATE", "EDIT"]),
    prompt: z.string(),
    /** What this job asked the provider for, so a retry can ask the same. */
    settings: imageStudioSettingsSchema,
    /** The versions it referenced, so a retry keeps every one of them. */
    referenceAssetIds: z.array(z.string().uuid()),
    error: z.string().nullable(),
    parentAssetId: z.string().uuid().nullable(),
    assetId: z.string().uuid().nullable(),
    createdAt: dateTimeSchema,
    submittedAt: dateTimeSchema.nullable(),
    settledAt: dateTimeSchema.nullable(),
    /**
     * Set once the provider accepted a cancellation request. Not the same as
     * the job being over: fal may accept a cancellation and finish anyway, so
     * a job can carry this and still produce a version.
     */
    cancelRequestedAt: dateTimeSchema.nullable(),
    /**
     * True only for a submission whose outcome is unknown. A client must not
     * offer a one-click retry for these without saying that it may be charged
     * a second time.
     */
    retryMayDuplicateCharge: z.boolean(),
  })
  .openapi("ProjectImageJob");

export const imageStudioSessionSchema = z
  .object({
    id: z.string().uuid(),
    eveSessionId: z.string(),
    title: z.string().nullable(),
    createdByUserId: z.string(),
    lastActivityAt: dateTimeSchema,
    createdAt: dateTimeSchema,
  })
  .openapi("ProjectImageSession");

export const createImageJobRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(4_000),
    settings: imageStudioSettingsSchema.optional(),
    referenceAssetIds: z.array(z.string().uuid()).max(4).default([]),
    parentAssetId: z.string().uuid().nullable().default(null),
    sessionId: z.string().uuid().nullable().default(null),
    /**
     * Replay guard. The same key in the same project always returns the same
     * job, so a client that never saw the response can retry safely.
     */
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .openapi("CreateProjectImageJobRequest");

export const reviewImageAssetRequestSchema = z
  .object({
    decision: z.enum(["APPROVED", "REJECTED"]),
    feedback: z.string().trim().max(2_000).nullable().default(null),
  })
  .openapi("ReviewProjectImageAssetRequest");

export const bindImageSessionRequestSchema = z
  .object({
    eveSessionId: z.string().trim().min(1).max(200),
    title: z.string().trim().max(200).nullable().default(null),
  })
  .openapi("BindProjectImageSessionRequest");

export const imageStudioStateQuerySchema = z.object({
  /**
   * A version the caller is looking at. It is returned whatever its age, so a
   * selection older than the newest page does not vanish from the client.
   */
  assetId: z.string().uuid().optional(),
  /** `createdAt` of the oldest asset the caller already has, for older pages. */
  before: z.string().datetime().optional(),
  /**
   * `id` of that same asset. Paired with `before` so versions sharing a
   * timestamp are not stepped over — which a timestamp-only cursor does.
   */
  beforeId: z.string().uuid().optional(),
});

export const imageStudioListSchema = z
  .object({
    assets: z.array(imageStudioAssetSchema),
    jobs: z.array(imageStudioJobSchema),
    sessions: z.array(imageStudioSessionSchema),
    /**
     * Pass back as `before` and `beforeId` to fetch the next, older page. Null
     * when the caller has reached the beginning.
     */
    nextCursor: z
      .object({ createdAt: dateTimeSchema, id: z.string().uuid() })
      .nullable(),
  })
  .openapi("ProjectImageStudioState");

export function assetContentPath(projectId: string, assetId: string): string {
  return `/v1/projects/${projectId}/image-studio/assets/${assetId}/content`;
}

/** Body of the agent's session registration call. */
export const registerImageStudioSessionRequestSchema = z.object({
  /** The id eve minted for the session the agent has just created. */
  eveSessionId: z.string().min(1).max(200),
  title: z.string().max(200).nullish(),
});

/** What the agent needs back to decide whether to deliver the first message. */
export const registerImageStudioSessionSchema = z.object({
  sessionId: z.string().uuid(),
  /**
   * True when this call created the record. False means the agent is retrying
   * an `operationId` creation onto a conversation it already owns, whose first
   * message has already been delivered.
   */
  created: z.boolean(),
});
