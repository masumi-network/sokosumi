/**
 * Special category slugs used for agent grouping and filtering.
 * These are not regular categories but represent special groupings:
 * - New: agents marked as new based on creation date
 * - Others: agents with no categories assigned
 */
export const AGENT_CATEGORY_SLUGS = {
  FEATURED: "featured",
  NEW: "new",
  DEFAULT: "default",
} as const;
