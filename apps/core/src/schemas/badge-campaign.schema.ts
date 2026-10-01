import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

/**
 * The Announced features a Badge campaign can point at. Each one is a sidebar
 * destination that exists in code, so admins pick from this list rather than
 * typing a key. Adding one is a change here plus the row in Web; the column
 * is a plain string, so no migration.
 */
export const ANNOUNCED_FEATURES = [
  "SOKO_BOTS",
  "CONTENT_STUDIO",
  "SOCIAL",
  "DRIVE",
] as const;

export const announcedFeatureSchema = z
  .enum(ANNOUNCED_FEATURES)
  .openapi("AnnouncedFeature");

export type AnnouncedFeature = z.infer<typeof announcedFeatureSchema>;

export const badgeCampaignSchema = z
  .object({
    id: z.string().openapi({ example: "01960001-0001-7001-8001-000000000001" }),
    feature: announcedFeatureSchema.openapi({ example: "DRIVE" }),
    startsAt: dateTimeSchema,
    endsAt: dateTimeSchema,
    createdAt: dateTimeSchema,
  })
  .openapi("BadgeCampaign");

export const badgeCampaignIdParamsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Badge campaign ID",
    example: "01960001-0001-7001-8001-000000000001",
  }),
});

const badgeCampaignWindowShape = {
  startsAt: z.iso
    .datetime()
    .openapi({ example: "2026-10-01T00:00:00.000Z", format: "date-time" }),
  endsAt: z.iso
    .datetime()
    .openapi({ example: "2026-10-22T00:00:00.000Z", format: "date-time" }),
};

function endsAfterStart(window: { startsAt: string; endsAt: string }) {
  return new Date(window.endsAt) > new Date(window.startsAt);
}

const endsAfterStartIssue = {
  message: "endsAt must be after startsAt",
  path: ["endsAt"],
};

export const createBadgeCampaignRequestSchema = z
  .object({ feature: announcedFeatureSchema, ...badgeCampaignWindowShape })
  .refine(endsAfterStart, endsAfterStartIssue)
  .openapi("CreateBadgeCampaignRequest");

export const updateBadgeCampaignRequestSchema = z
  .object(badgeCampaignWindowShape)
  .refine(endsAfterStart, endsAfterStartIssue)
  .openapi("UpdateBadgeCampaignRequest");

export const userBadgeCampaignsResponseSchema = z
  .object({
    badgeCampaigns: z.array(
      z.object({
        id: z.string(),
        feature: announcedFeatureSchema,
        endsAt: dateTimeSchema,
      }),
    ),
  })
  .openapi("UserBadgeCampaigns");
