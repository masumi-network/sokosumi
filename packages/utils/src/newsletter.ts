import { z } from "zod";

const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);

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
  }),
  z.object({
    type: z.literal("button"),
    label: z.string().min(1).max(200),
    url: httpsUrl,
  }),
  z.object({ type: z.literal("divider") }),
]);

export const newsletterContentSchema = z.array(newsletterBlockSchema).max(200);
export type NewsletterBlock = z.infer<typeof newsletterBlockSchema>;

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
