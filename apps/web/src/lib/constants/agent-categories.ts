/**
 * Special category slugs used for agent grouping and filtering.
 * These are not regular categories but represent special groupings:
 * - Featured Agents: agents with the "featured-agents" category
 * - New Agents: agents marked as new based on creation date
 * - Others: agents with no categories assigned
 */
export const AGENT_CATEGORY_SLUGS = {
  FEATURED: "featured-agents",
  NEW: "new-agents",
  OTHERS: "others",
} as const;
