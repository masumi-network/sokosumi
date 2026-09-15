/**
 * Maximum text length per social provider for a Social post.
 * Client-safe: web reuses it for composer validation, Core for request validation.
 */
export const SOCIAL_POST_TEXT_LIMITS = { x: 280 } as const;

export type SocialPostProvider = keyof typeof SOCIAL_POST_TEXT_LIMITS;
