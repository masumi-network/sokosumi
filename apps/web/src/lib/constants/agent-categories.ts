/**
 * Special category slugs used for agent grouping and filtering.
 * These are not regular categories but represent special groupings:
 * - Featured: featured agents
 * - New: agents marked as new based on creation date
 * - Default: agents with no categories assigned
 */
export const SPECIAL_AGENT_CATEGORY_SLUGS = {
  FEATURED: "featured",
  NEW: "new",
  DEFAULT: "default",
} as const;
