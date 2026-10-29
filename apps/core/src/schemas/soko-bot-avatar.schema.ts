import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { AVATAR_STATES, mapAvatarStates } from "@/lib/soko-bot-avatar/style";

export const sokoBotAvatarSchema = z
  .object({
    id: z.string().uuid(),
    imageUrl: z.string(),
    subject: z.string(),
    background: z.string(),
  })
  .openapi("SokoBotAvatar");

export const listSokoBotAvatarsQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(12).default(6),
  /** Comma-separated avatar ids already shown; ask for a fresh set. */
  exclude: z.string().max(1_000).optional(),
});

/**
 * Body for the top-up POST. Generation bills a third party and writes rows, so
 * it never rides on the GET: a GET is cacheable and a cross-site top-level
 * navigation carries the session cookie under `SameSite=Lax`.
 */
export const topUpSokoBotAvatarsRequestSchema = z.object({
  // One POST generates at most six images (`MAX_TOP_UP_PER_CALL`) and does
  // not batch. Asking for more than that cannot fill the shortfall.
  take: z.number().int().min(1).max(6).default(6),
  /**
   * Avatar ids already shown; ask for a fresh set. The cap matches the one the
   * web action enforces on the picker.
   */
  excludeIds: z.array(z.string().uuid()).max(60).default([]),
});

export const claimSokoBotAvatarRequestSchema = z
  .object({ avatarId: z.string().uuid() })
  .openapi("ClaimSokoBotAvatarRequest");

/** What a bot's face is doing. One rule, derived in Core, shown by every client. */
export const sokoBotAvatarStateSchema = z
  .enum(AVATAR_STATES)
  .openapi("SokoBotAvatarState");

export const sokoBotAvatarStateAssetsSchema = z
  .object({
    stillUrl: z.string(),
    /** Animated WebP, 320 px. Null until its loop is ready. */
    loopUrl: z.string().nullable(),
    /** Animated WebP, 560 px. */
    loopLargeUrl: z.string().nullable(),
  })
  .openapi("SokoBotAvatarStateAssets");

const stateAssetsOrNull = z.union([sokoBotAvatarStateAssetsSchema, z.null()]);

/**
 * Where a bot's stills and loops live. A legacy avatar has one image and no
 * states (every state null). A state is null until its still exists.
 */
export const sokoBotAvatarViewSchema = z
  .object({
    styleId: z.string(),
    styleVersion: z.number().int(),
    /** The idle still. */
    stillUrl: z.string(),
    states: z.object(mapAvatarStates(() => stateAssetsOrNull)),
  })
  .openapi("SokoBotAvatarView");

export const sokoBotAvatarOrNullSchema = z.union([
  sokoBotAvatarViewSchema,
  z.null(),
]);

export const sokoBotAvatarLookSchema = z
  .object({
    creature: z.string(),
    accessories: z.array(z.string()),
    /** Typed changes applied so far, as the rewriter phrased them. */
    typed: z.array(z.string()),
  })
  .openapi("SokoBotAvatarLook");

/** One change to a look. Typed text goes through the rewriter first. */
export const sokoBotAvatarChangeSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("creature"),
      creature: z.string().min(1).max(40),
    }),
    z.object({
      kind: z.literal("accessory"),
      accessory: z.string().min(1).max(40),
      /** False takes the accessory off. */
      enabled: z.boolean().default(true),
    }),
    z.object({ kind: z.literal("shuffle") }),
    z.object({
      kind: z.literal("typed"),
      text: z.string().trim().min(1).max(300),
    }),
  ])
  .openapi("SokoBotAvatarChange");

export const createSokoBotAvatarDraftRequestSchema = z
  .object({
    change: sokoBotAvatarChangeSchema,
    /** The draft to edit. Omit to edit the bot's current look. */
    draftId: z.string().uuid().optional(),
  })
  .openapi("CreateSokoBotAvatarDraftRequest");

export const sokoBotAvatarDraftSchema = z
  .object({
    id: z.string().uuid(),
    imageUrl: z.string(),
    look: sokoBotAvatarLookSchema,
    expiresAt: dateTimeSchema,
  })
  .openapi("SokoBotAvatarDraft");

export const sokoBotAvatarDraftResultSchema = z
  .object({
    /** Null when nothing changed: the rewriter refused, or the look already had it. */
    draft: z.union([sokoBotAvatarDraftSchema, z.null()]),
    /** A short sentence for the person editing about what was applied or left out. */
    note: z.string(),
  })
  .openapi("SokoBotAvatarDraftResult");

export const keepSokoBotAvatarDraftParamsSchema = z.object({
  draftId: z
    .string()
    .uuid()
    .openapi({ param: { name: "draftId", in: "path" } }),
});

const optionSchema = z.object({ id: z.string() });

export const sokoBotAvatarStudioSchema = z
  .object({
    avatar: sokoBotAvatarOrNullSchema,
    /** Null for a legacy avatar or none. */
    look: z.union([sokoBotAvatarLookSchema, z.null()]),
    /** The newest unexpired draft, so a reload resumes it. */
    draft: z.union([sokoBotAvatarDraftSchema, z.null()]),
    /** How many of the six states are fully rendered. */
    progress: z.object({
      ready: z.number().int(),
      failed: z.number().int(),
      total: z.number().int(),
    }),
    options: z.object({
      creatures: z.array(optionSchema),
      accessories: z.array(optionSchema),
    }),
  })
  .openapi("SokoBotAvatarStudio");
