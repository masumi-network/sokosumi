import { z } from "zod";

/** Shared allowlist for project and workspace performance reads. */
export const socialPerformanceQuerySchema = z.object({
  provider: z
    .enum(["x", "instagram", "facebook", "linkedin", "tiktok", "youtube"])
    .optional(),
  connectionId: z.uuid().optional(),
  publishedFrom: z.iso.datetime({ offset: true }).optional(),
  publishedUntil: z.iso.datetime({ offset: true }).optional(),
  timezone: z.string().max(100).optional(),
  search: z.string().max(200).optional(),
  contentType: z
    .enum(["text", "image", "video", "carousel", "link", "unknown"])
    .optional(),
  postKind: z.enum(["posts", "replies", "quotes", "reposts", "all"]).optional(),
  sort: z
    .enum([
      "publishedAt",
      "views",
      "impressions",
      "likes",
      "interactions",
      "engagementRate",
      "baselineMultiplier",
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(100000).optional(),
});
