/**
 * Special category slugs used for agent grouping and filtering.
 * These are not regular database categories but represent special groupings:
 * - Featured: featured agents
 * - New: agents marked as new based on creation date
 * - Default: synthetic fallback for agents without categories
 */
export const SPECIAL_AGENT_CATEGORY_SLUGS = {
  FEATURED: "featured",
  NEW: "new",
  DEFAULT: "default",
} as const;

/**
 * Synthetic default category injected at runtime for agents without categories in the database.
 * This ensures filtering and grouping logic always has a fallback bucket.
 */
export const SYNTHETIC_DEFAULT_CATEGORY = {
  slug: SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT,
  name: "Others",
  priority: 9999,
} as const;
