import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";
import { getImageCatalog } from "@/lib/image-studio/catalog";
import { IMAGE_JOB_FAILURE_REASONS } from "@/lib/image-studio/failure-reason";
import {
  DEFAULT_IMAGE_MODEL_ID,
  IMAGE_ASPECT_RATIOS,
  IMAGE_OUTPUT_FORMATS,
  IMAGE_PROVIDER_FIELDS,
  IMAGE_RESOLUTIONS,
} from "@/lib/image-studio/image-model";
import { IMAGE_PROMPT_MAX_LENGTH } from "@/lib/image-studio/request-validation";

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

export const imageStudioAssetSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    /** The owning project's name, so a workspace-wide gallery can label it. */
    projectName: z.string(),
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
  })
  .openapi("ProjectImageAsset");

export const imageStudioJobSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    status: z.enum(IMAGE_JOB_STATUSES),
    kind: z.enum(["GENERATE", "EDIT"]),
    model: z.string(),
    prompt: z.string(),
    /** What this job asked the provider for, so a retry can ask the same. */
    settings: imageStudioSettingsSchema,
    /** The versions it referenced, so a retry keeps every one of them. */
    referenceAssetIds: z.array(z.string().uuid()),
    /**
     * One sentence a person can read, written by the studio. Never the
     * provider's own words: a raw transport string is not something anybody can
     * act on, so it goes to the server log instead.
     */
    error: z.string().nullable(),
    /**
     * The stable reason a client should branch on and translate. Prefer it over
     * `error`, which is an English fallback.
     *
     * Null for a job that failed before the studio recorded a reason, and for the
     * one outage case whose own wording says more than a code could — fall back
     * to `error` there. `unknown` means this API saw a code it does not know,
     * which is how a newer Core stays readable by an older client.
     */
    failureReason: z.enum(IMAGE_JOB_FAILURE_REASONS).nullable(),
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
    /**
     * What this generation cost, in the same user-facing decimal the rest of the
     * API uses.
     *
     * The studio charges on delivery, so this is **null until there is an image**
     * — including for a job that failed, which costs nothing. A client that wants
     * to show a price before then computes it from the catalog with
     * `creditsPerImageCents`, the same way the composer's estimate does.
     */
    credits: z.number().nullable(),
    /**
     * @deprecated Always false. The studio charges on delivery, so a failed
     * generation moves no money and there is nothing to refund. Kept for one
     * release so clients can drop their refunded branch; read `credits` instead.
     */
    refunded: z.boolean(),
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
    /**
     * A catalog model id.
     *
     * Not a Zod enum, because the catalog is read from fal and moves without a
     * deploy: a fixed list compiled into the schema would reject a model the
     * studio is already offering. The refinement reads the *resolved* catalog at
     * parse time instead, so a model that appeared in the last refresh is
     * accepted and an unknown id is still a 400 rather than reaching the
     * reservation. `resolveImageSettings` checks it again before anything is
     * charged, because the schema is not the only way into that code.
     */
    modelId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .default(DEFAULT_IMAGE_MODEL_ID)
      .refine(
        (id) => getImageCatalog().models.some((model) => model.id === id),
        { message: "Unknown image model. Choose one from the studio catalog." },
      ),
    prompt: z.string().trim().min(1).max(IMAGE_PROMPT_MAX_LENGTH),
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

/**
 * One catalog row, and the whole contract a client has about a model.
 *
 * Lean on purpose: this ships about a hundred and fifty times, so nothing is
 * repeated here that a client does not read. It used to ride inside every poll
 * of the studio state; it now has its own cached route for exactly that reason.
 */
export const imageStudioCatalogModelSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    description: z.string(),
    generateEndpoint: z.string(),
    /**
     * Null when fal lists no `/edit` variant. Such a model generates and cannot
     * refine: a client must offer no refine, no references, and no "make a
     * variation of this" for it. `maxReferences` is 0 for the same models.
     */
    editEndpoint: z.string().nullable(),
    aspectRatios: z.array(z.string()),
    resolutions: z.array(z.string()),
    /** Empty means the model chooses its own format and none is sent. */
    outputFormats: z.array(z.string()),
    supportsSeed: z.boolean(),
    maxReferences: z.number().int(),
    dimensionMode: z.enum(["aspect-ratio", "image-size"]),
    /** The provider input properties this endpoint declares. */
    providerFields: z.array(z.enum(IMAGE_PROVIDER_FIELDS)),
    /** 1-5 for the curated shortlist, in order. Null for everything else. */
    curatedRank: z.number().int().nullable(),
    notes: z.string(),
    /**
     * fal's published list price, and the inputs to the credits figure.
     *
     * A client computes credits with `creditsPerImageCents` from
     * `@sokosumi/utils`, the same function Core charges with, so the estimate the
     * composer shows and the debit the reservation takes cannot disagree.
     */
    price: z.object({
      /** fal's own unit, e.g. `images` or `megapixels`. */
      unit: z.string(),
      unitPriceUsd: z.number(),
      /**
       * Hand-verified USD per image by resolution tier, where fal's unit alone
       * does not describe one image. `partialRecord`, not `record`: a plain
       * record over an enum is exhaustive in Zod 4, and no model offers every
       * tier.
       */
      perImageUsd: z
        .partialRecord(z.enum(IMAGE_RESOLUTIONS), z.number())
        .optional(),
      basis: z.string(),
      sourceUrl: z.string(),
      verifiedAt: z.string(),
    }),
    sourceUrls: z.array(z.string()),
    verifiedAt: z.string(),
  })
  .openapi("ProjectImageStudioCatalogModel");

export const imageStudioCatalogSchema = z
  .object({
    defaultModelId: z.string(),
    models: z.array(imageStudioCatalogModelSchema),
    /** When the committed cold-start snapshot behind this catalog was captured. */
    snapshotDate: z.string(),
    /** When this instance last refreshed from fal. Null on a cold start. */
    refreshedAt: z.string().nullable(),
  })
  .openapi("ProjectImageStudioCatalog");

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

/**
 * The studio across every project in the workspace. The project state without
 * `sessions`: conversations are bound to one project and mean nothing here.
 */
export const imageStudioWorkspaceStateSchema = imageStudioListSchema
  .omit({ sessions: true })
  .openapi("ImageStudioWorkspaceState");

export function assetContentPath(projectId: string, assetId: string): string {
  return `/v1/projects/${projectId}/image-studio/assets/${assetId}/content`;
}

/** What is known about a conversation's first message. */
export const imageStudioInitialTurnSchema = z.enum([
  "NONE",
  "PENDING",
  "CLAIMED",
  "DELIVERING",
  "DELIVERED",
  "UNCERTAIN",
]);

/** Body of the agent's session registration call. */
export const registerImageStudioSessionRequestSchema = z.object({
  /** The id eve minted for the session the agent has just created. */
  eveSessionId: z.string().min(1).max(200),
  title: z.string().max(200).nullish(),
  /**
   * The caller's stable name for this creation, repeated by every retry of it.
   * Conversations are matched on this, so a retry lands on the conversation
   * its first attempt created rather than starting a second one.
   */
  clientIntentId: z.string().min(1).max(200).nullish(),
  /** True when a first message is owed once the conversation is recorded. */
  expectsInitialTurn: z.boolean().optional(),
});

/** What the agent needs back to decide whether to deliver the first message. */
export const registerImageStudioSessionSchema = z.object({
  sessionId: z.string().uuid(),
  /**
   * The conversation this creation belongs to. Not necessarily the id in the
   * request: a retry of a known intent is answered with the conversation the
   * first attempt created, and the id this attempt minted is abandoned.
   */
  eveSessionId: z.string(),
  /**
   * True when this call inserted the record. Says nothing about whether the
   * first message was delivered — that is `initialTurn`, and confusing the two
   * is what dropped first messages on retry.
   */
  created: z.boolean(),
  initialTurn: imageStudioInitialTurnSchema,
  /**
   * True only for the one caller holding the delivery lease. Every other
   * caller must not dispatch, whatever else it knows.
   */
  mayDeliver: z.boolean(),
  /**
   * The lease granted to this caller. Presented again when announcing the
   * dispatch and reporting its outcome, so an attempt whose lease was taken
   * over cannot deliver after the fact.
   */
  deliveryToken: z.string().nullable(),
});

/** Body of the agent's initial-turn transition call. */
export const recordImageStudioInitialTurnRequestSchema = z.object({
  /**
   * What the caller wants to do, or observed. `claim` asks for the right to
   * deliver — the way every first-message path, creation and an ordinary send
   * into a conversation that still owes one, enters this decision.
   * `dispatching` is announced before the send, so a crashed attempt can be
   * told from one that never started. `undelivered` means the runtime refused,
   * so the message is owed again; `uncertain` means the outcome could not be
   * read and nothing may redeliver it automatically.
   */
  transition: z.enum([
    "claim",
    "dispatching",
    "delivered",
    "undelivered",
    "uncertain",
  ]),
  /** The lease the caller holds. Required to announce a dispatch. */
  deliveryToken: z.string().min(1).max(200).nullish(),
});

/** The conversation's first-message state after the transition. */
export const recordImageStudioInitialTurnSchema = z.object({
  sessionId: z.string().uuid(),
  eveSessionId: z.string(),
  initialTurn: imageStudioInitialTurnSchema,
  /**
   * False when the transition was refused: another attempt holds the lease, or
   * the state does not allow it. Such a caller must not send.
   */
  accepted: z.boolean(),
  /** True only for a `claim` that granted the lease. */
  mayDeliver: z.boolean(),
  /** The lease granted by a `claim`, presented on every later transition. */
  deliveryToken: z.string().nullable(),
});
