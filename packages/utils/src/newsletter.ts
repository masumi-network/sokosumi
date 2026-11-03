import { z } from "zod";

const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);
const hexColor = z.string().regex(/^#(?:[\da-f]{3}|[\da-f]{6})$/i);

export const NEWSLETTER_SOCIAL_NETWORKS = [
  "website",
  "x",
  "linkedin",
  "instagram",
  "facebook",
  "youtube",
  "tiktok",
] as const;

/** Shared editor blocks; raw HTML is never part of newsletter content. */
export const newsletterBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heading"),
    text: z.string().max(1000),
    level: z.union([z.literal(1), z.literal(2)]),
  }),
  z.object({ type: z.literal("text"), text: z.string().max(100_000) }),
  z.object({
    type: z.literal("image"),
    url: httpsUrl,
    alt: z.string().max(1000),
    href: httpsUrl.optional(),
    /** Percent of the content width; full width when unset. */
    width: z.int().min(10).max(100).optional(),
    align: z.enum(["left", "center", "right"]).optional(),
  }),
  z.object({
    type: z.literal("button"),
    label: z.string().min(1).max(200),
    url: httpsUrl,
  }),
  z.object({ type: z.literal("divider") }),
  z.object({
    type: z.literal("columns"),
    columns: z
      .array(
        z.object({
          text: z.string().max(20_000),
          imageUrl: httpsUrl.optional(),
          alt: z.string().max(1000).optional(),
        }),
      )
      .min(2)
      .max(3),
  }),
  z.object({ type: z.literal("spacer"), size: z.enum(["sm", "md", "lg"]) }),
  z.object({
    type: z.literal("social"),
    links: z
      .array(
        z.object({
          network: z.enum(NEWSLETTER_SOCIAL_NETWORKS),
          url: httpsUrl,
        }),
      )
      .min(1)
      .max(8),
  }),
  z.object({ type: z.literal("footer"), text: z.string().max(5000) }),
]);

export const newsletterContentSchema = z.array(newsletterBlockSchema).max(200);
export type NewsletterBlock = z.infer<typeof newsletterBlockSchema>;

/**
 * A project's email design, stored as the newsletter's `brand`. Every field is
 * optional so designs saved before a field existed keep parsing.
 */
export const newsletterBrandSchema = z.object({
  logoUrl: z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .optional(),
  primaryColor: hexColor.optional(),
  accentColor: hexColor.optional(),
  fontFamily: z.string().trim().min(1).max(200).optional(),
  footerText: z.string().max(5000).optional(),
  /** Page color behind the email card. */
  backgroundColor: hexColor.optional(),
  /** Label color on accent-filled buttons. */
  buttonTextColor: hexColor.optional(),
  buttonShape: z.enum(["square", "rounded", "pill"]).optional(),
  /** A banner above the logo. */
  headerImageUrl: httpsUrl.optional(),
  headerAlign: z.enum(["left", "center"]).optional(),
  spacing: z.enum(["compact", "normal", "roomy"]).optional(),
});
export type NewsletterBrand = z.infer<typeof newsletterBrandSchema>;

/** Drafting accepts source choices only, never delivery or approval state. */
export const newsletterDraftInputSchema = z
  .object({
    brief: z.string().trim().min(1).max(10_000),
    useProjectMemory: z.boolean().default(false),
    useRecentSocialPosts: z.boolean().default(false),
    template: z.enum(["TEXT", "IMAGES", "BUTTONS"]).default("TEXT"),
    imageIds: z.array(z.uuid()).max(10).default([]),
  })
  .strict();

/** The hosted signup page, its archive and the iframe that embeds it elsewhere. */
export function newsletterSignupLinks(
  publicSlug: string,
  baseUrl: string,
  embedTitle: string,
) {
  const signupUrl = new URL(
    `/n/${encodeURIComponent(publicSlug)}`,
    baseUrl,
  ).toString();
  return {
    signupUrl,
    archiveUrl: `${signupUrl}/archive`,
    embedHtml: `<iframe src="${signupUrl}/embed" title="${embedTitle}" width="100%" height="440" style="border:0;background:transparent;" loading="lazy"></iframe>`,
  };
}
