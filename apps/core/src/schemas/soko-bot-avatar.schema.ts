import { z } from "@hono/zod-openapi";

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
