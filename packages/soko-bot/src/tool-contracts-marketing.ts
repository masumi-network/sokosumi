import {
  AD_CAMPAIGN_SETTABLE_STATUSES,
  GOOGLE_DISPLAY_IMAGE_ROLES,
  GOOGLE_KEYWORD_MATCH_TYPES,
  isValidTimezone,
  newsletterBlockSchema,
  newsletterBrandSchema,
  newsletterColumnsBlockSchema,
  newsletterImageBlockSchema,
  SOCIAL_POST_FIRST_COMMENT_MAX,
  SOCIAL_POST_MEDIA_MAX,
  SOCIAL_POST_TEXT_MAX,
  SOCIAL_POST_THREAD_MAX_PARTS,
} from "@sokosumi/utils";
import { z } from "zod";

export const socialProjectInputSchema = z
  .object({ projectId: z.uuid() })
  .strict();

export const adAccountInputSchema = socialProjectInputSchema.extend({
  accountId: z.uuid(),
});

// Mirrors AD_RANGES in Core's ads library.
export const adRangeSchema = z
  .enum(["LAST_7_DAYS", "LAST_30_DAYS"])
  .default("LAST_30_DAYS");

export const listAdCampaignsInputSchema = adAccountInputSchema.extend({
  range: adRangeSchema,
});

export const findAdTargetingInputSchema = adAccountInputSchema.extend({
  locationQuery: z.string().trim().min(1).max(200).optional(),
});

// Core checks the full Google rules; these bound the request only.
export const adDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const adIdSchema = z.string().regex(/^\d{1,20}$/);

export const adIdsSchema = z.array(adIdSchema).max(25);

export const adUrlSchema = z.url({ protocol: /^https?$/ }).max(2048);

export const adTextsSchema = (min: number, max: number, length: number) =>
  z.array(z.string().trim().min(1).max(length)).min(min).max(max);

export const adCampaignSpecShape = {
  startDate: adDateSchema.optional(),
  endDate: adDateSchema.optional(),
  locationIds: adIdsSchema,
  languageIds: adIdsSchema,
  finalUrl: adUrlSchema,
};

export const adImageRoleSchema = z.enum(GOOGLE_DISPLAY_IMAGE_ROLES);

export const googleSearchCampaignSchema = z
  .object({
    type: z.literal("SEARCH"),
    ...adCampaignSpecShape,
    keywords: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(80),
            matchType: z.enum(GOOGLE_KEYWORD_MATCH_TYPES),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    headlines: adTextsSchema(3, 15, 30),
    descriptions: adTextsSchema(2, 4, 90),
    path1: z.string().trim().min(1).max(15).optional(),
    path2: z.string().trim().min(1).max(15).optional(),
    sitelinks: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(25),
            finalUrl: adUrlSchema,
            description1: z.string().trim().min(1).max(35).optional(),
            description2: z.string().trim().min(1).max(35).optional(),
          })
          .strict(),
      )
      .max(8)
      .optional(),
    callouts: adTextsSchema(0, 10, 25).optional(),
  })
  .strict();

export const adNewImageSchema = z
  .object({ fileId: z.uuid(), role: adImageRoleSchema })
  .strict();

export const googleDisplayCampaignSchema = z
  .object({
    type: z.literal("DISPLAY"),
    ...adCampaignSpecShape,
    businessName: z.string().trim().min(1).max(25),
    headlines: adTextsSchema(1, 5, 30),
    longHeadline: z.string().trim().min(1).max(90),
    descriptions: adTextsSchema(1, 5, 90),
    images: z.array(adNewImageSchema).max(8),
  })
  .strict();

export const googleCampaignSchema = z.discriminatedUnion("type", [
  googleSearchCampaignSchema,
  googleDisplayCampaignSchema,
]);

// An edit keeps the ad's current images by asset id beside the new ones.
export const googleCampaignEditSchema = z.discriminatedUnion("type", [
  googleSearchCampaignSchema,
  googleDisplayCampaignSchema.extend({
    images: z
      .array(
        z.union([
          adNewImageSchema,
          z.object({ assetId: adIdSchema, role: adImageRoleSchema }).strict(),
        ]),
      )
      .max(8),
  }),
]);

export const createAdCampaignInputSchema = adAccountInputSchema.extend({
  name: z.string().trim().min(1).max(255),
  dailyBudget: z.number().positive(),
  google: googleCampaignSchema,
});

export const adCampaignInputSchema = adAccountInputSchema.extend({
  campaignId: adIdSchema,
});

export const getAdCampaignInputSchema = adCampaignInputSchema.extend({
  range: adRangeSchema,
});

export const updateAdCampaignInputSchema = adCampaignInputSchema
  .extend({
    status: z.enum(AD_CAMPAIGN_SETTABLE_STATUSES).optional(),
    dailyBudget: z.number().positive().optional(),
  })
  // Google writes a budget and a status separately: one change per call, so a
  // refused call changed nothing.
  .refine(
    ({ status, dailyBudget }) =>
      (status === undefined) !== (dailyBudget === undefined),
    { message: "Set either status or dailyBudget; send one change per call" },
  );

export const editAdCampaignInputSchema = adCampaignInputSchema.extend({
  name: z.string().trim().min(1).max(255),
  dailyBudget: z.number().positive(),
  google: googleCampaignEditSchema,
});

export const socialPostInputSchema = socialProjectInputSchema.extend({
  postId: z.uuid(),
});

export const socialPostRevisionSchema = z.number().int().min(0);

export const socialPostMutationInputSchema = socialPostInputSchema.extend({
  revision: socialPostRevisionSchema,
});

export const socialPostTextSchema = z.string().trim().max(SOCIAL_POST_TEXT_MAX);

export const socialPostMediaSchema = z
  .array(
    z.union([
      // A Drive file by the id list_files or get_image returned. Core looks up
      // the rest, so a bot never needs the file's storage address.
      z.object({ fileId: z.uuid() }).strict(),
      z
        .object({
          pathname: z.string().min(1),
          fileUrl: z.url(),
          name: z.string().min(1),
          size: z.number().int().min(0),
          mimeType: z.string().min(1),
          kind: z.enum(["image", "gif", "video"]),
        })
        .strict(),
    ]),
  )
  .max(SOCIAL_POST_MEDIA_MAX);

// Core checks each account's own limits; these bound the request only.
export const socialPostFirstCommentSchema = z
  .string()
  .trim()
  .max(SOCIAL_POST_FIRST_COMMENT_MAX);

export const socialPostThreadPartsSchema = z
  .array(
    z
      .object({
        text: socialPostTextSchema,
        media: socialPostMediaSchema.optional(),
      })
      .strict(),
  )
  .max(SOCIAL_POST_THREAD_MAX_PARTS - 1);

export const socialPostScheduledAtSchema = z.iso.datetime({ offset: true });

/** Keeps a link in the post body, which is refused unless the owner asked for it there. */
export const socialPostLinkInPostSchema = z.boolean().optional();

export const socialPostTimezoneSchema = z.string().refine(isValidTimezone, {
  message: "timezone must be a valid IANA time zone",
});

export const listSocialPostsInputSchema = socialProjectInputSchema.extend({
  quoteCandidates: z.boolean().optional(),
  excludePostId: z.uuid().optional(),
  search: z.string().trim().max(500).optional(),
  cursor: z.uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  statuses: z
    .array(
      z.enum([
        "DRAFT",
        "NEEDS_APPROVAL",
        "SCHEDULED",
        "PUBLISHING",
        "PUBLISHED",
        "FAILED",
        "MISSED",
        "CANCELED",
      ]),
    )
    .min(1)
    .optional(),
});

export const listSocialPostStatisticsInputSchema = socialProjectInputSchema
  .extend({
    provider: z
      .enum(["x", "linkedin", "facebook", "instagram", "tiktok", "youtube"])
      .optional(),
    publishedFrom: socialPostScheduledAtSchema.optional(),
    publishedUntil: socialPostScheduledAtSchema.optional(),
    cursor: z.uuid().optional(),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .refine(
    (input) =>
      !input.publishedFrom ||
      !input.publishedUntil ||
      new Date(input.publishedFrom) <= new Date(input.publishedUntil),
    {
      message: "publishedFrom must not be after publishedUntil",
    },
  );

export const createSocialPostInputSchema = socialProjectInputSchema
  .extend({
    text: socialPostTextSchema,
    firstComment: socialPostFirstCommentSchema.optional(),
    media: socialPostMediaSchema.optional(),
    threadParts: socialPostThreadPartsSchema.optional(),
    quotedPostId: z.uuid().nullable().optional(),
    socialConnectionId: z.uuid().optional(),
    scheduledAt: socialPostScheduledAtSchema.optional(),
    timezone: socialPostTimezoneSchema.optional(),
    linkInPost: socialPostLinkInPostSchema,
  })
  .refine((input) => input.text.length > 0 || (input.media?.length ?? 0) > 0, {
    message: "Text or media is required",
  });

export const updateSocialPostInputSchema = socialPostMutationInputSchema.extend(
  {
    text: socialPostTextSchema.optional(),
    firstComment: socialPostFirstCommentSchema.optional(),
    media: socialPostMediaSchema.optional(),
    threadParts: socialPostThreadPartsSchema.optional(),
    quotedPostId: z.uuid().nullable().optional(),
    socialConnectionId: z.uuid().nullable().optional(),
    linkInPost: socialPostLinkInPostSchema,
  },
);

export const scheduleSocialPostInputSchema =
  socialPostMutationInputSchema.extend({
    scheduledAt: socialPostScheduledAtSchema,
    timezone: socialPostTimezoneSchema.optional(),
    socialConnectionId: z.uuid().optional(),
  });

export const newsletterProjectInputSchema = z
  .object({ projectId: z.uuid() })
  .strict();

export const newsletterDateSchema = z.iso.date();

export const newsletterPageSchema = {
  cursor: z.uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
};

/** Files are resolved by Core after checking the bot's project and file access. */
export const newsletterToolContentSchema = z
  .array(
    z.discriminatedUnion("type", [
      newsletterImageBlockSchema
        .extend({
          url: newsletterImageBlockSchema.shape.url.optional(),
          fileId: z.uuid().optional(),
        })
        .strict()
        .refine(({ url, fileId }) => Boolean(url) !== Boolean(fileId), {
          message: "Provide an image url or fileId, not both",
        }),
      newsletterColumnsBlockSchema.extend({
        columns: newsletterColumnsBlockSchema.shape.columns.element
          .extend({ fileId: z.uuid().optional() })
          .strict()
          .refine(({ imageUrl, fileId }) => !imageUrl || !fileId, {
            message: "Provide an imageUrl or fileId, not both",
          })
          .array()
          .min(2)
          .max(3),
      }),
      ...newsletterBlockSchema.options.filter(
        (block) => !["image", "columns"].includes(block.shape.type.value),
      ),
    ]),
  )
  .max(200);

/** The issue fields the Newsletter editor sets; Core checks them again. */
export const newsletterIssueFields = {
  subject: z.string().trim().min(1).max(200),
  previewText: z.string().max(500).nullable().optional(),
  template: z.enum(["TEXT", "IMAGES", "BUTTONS"]),
  content: newsletterToolContentSchema.min(1),
};

export const newsletterIssueRefSchema = newsletterProjectInputSchema.extend({
  issueId: z.uuid(),
  revision: z.number().int().nonnegative(),
});

/** The newsletter brand the settings page sets; null removes a field. */
export const newsletterBrandColorSchema = z
  .string()
  .regex(/^#(?:[\da-f]{3}|[\da-f]{6})$/i, "Use a hex color such as #1a2b3c");

export const newsletterSignupFormPatchSchema = z
  .object({
    accentColor: newsletterBrandColorSchema.nullable(),
    buttonTextColor: newsletterBrandColorSchema.nullable(),
    buttonShape: newsletterBrandSchema.shape.buttonShape.unwrap().nullable(),
    headerAlign: newsletterBrandSchema.shape.headerAlign.unwrap().nullable(),
    spacing: newsletterBrandSchema.shape.spacing.unwrap().nullable(),
  })
  .partial()
  .strict()
  .refine((signupForm) => Object.keys(signupForm).length > 0, {
    message:
      "Provide at least one signup form override, or null to clear all overrides",
  });

export const newsletterBrandPatchSchema = z
  .object({
    logoUrl: z
      .url({ protocol: /^https$/ })
      .max(2048)
      .nullable(),
    primaryColor: newsletterBrandColorSchema.nullable(),
    accentColor: newsletterBrandColorSchema.nullable(),
    fontFamily: z.string().trim().min(1).max(200).nullable(),
    footerText: z.string().max(5000).nullable(),
    backgroundColor: newsletterBrandColorSchema.nullable(),
    buttonTextColor: newsletterBrandColorSchema.nullable(),
    buttonShape: newsletterBrandSchema.shape.buttonShape.unwrap().nullable(),
    headerImageUrl: newsletterBrandSchema.shape.headerImageUrl
      .unwrap()
      .nullable(),
    headerAlign: newsletterBrandSchema.shape.headerAlign.unwrap().nullable(),
    spacing: newsletterBrandSchema.shape.spacing.unwrap().nullable(),
    signupForm: newsletterSignupFormPatchSchema.nullable(),
  })
  .partial()
  .strict()
  .refine((brand) => Object.keys(brand).length > 0, {
    message: "Provide at least one brand field",
  });

/**
 * Most people one subscriber tool call may add, counted after the CSV is
 * parsed and contact lists are expanded. More go through the Subscribers page.
 */
export const SOKO_BOT_NEWSLETTER_SUBSCRIBER_BATCH_MAX = 100;

/** The Subscribers page's consent choice; Core parses it with the same schema. */
export const newsletterConsentInputSchema = z.enum(["CONFIRMED", "ASK"]);

export const newsletterSubscriberRefSchema =
  newsletterProjectInputSchema.extend({
    subscriberId: z.uuid(),
  });
