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
