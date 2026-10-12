import type { GoogleSearchCampaignSpec } from "@sokosumi/core-client";
import { GoogleSearchCampaignSpecSchema } from "@sokosumi/core-client/schemas";
import * as z from "zod";

import {
  GOOGLE_KEYWORD_LIMIT,
  GOOGLE_KEYWORD_MAX_LENGTH,
  GOOGLE_KEYWORD_MAX_WORDS,
  GOOGLE_MATCH_TYPES,
  type GoogleKeywordIssue,
  parseGoogleKeywords,
} from "./google-keywords";

const spec = GoogleSearchCampaignSpecSchema.properties;

/** Core's limits for a Search campaign's ad, from its API schema. */
export const GOOGLE_SEARCH_LIMITS = {
  headlines: {
    min: spec.headlines.minItems,
    max: spec.headlines.maxItems,
    length: spec.headlines.items.maxLength,
  },
  descriptions: {
    min: spec.descriptions.minItems,
    max: spec.descriptions.maxItems,
    length: spec.descriptions.items.maxLength,
  },
  path: spec.path1.maxLength,
  finalUrl: spec.finalUrl.maxLength,
  targetIds: spec.locationIds.maxItems,
} as const;

/** What a refusal says. Without them (the server action) zod's defaults do. */
export interface GoogleSearchMessages {
  finalUrl: string;
  headlineRequired: string;
  headlineTooLong: string;
  headlineDuplicate: string;
  descriptionRequired: string;
  descriptionTooLong: string;
  pathTooLong: string;
  pathNeedsFirst: string;
  endBeforeStart: string;
  keywordsRequired: string;
  keywordsTooMany: string;
  keywordsInvalid: (line: number, issue: GoogleKeywordIssue) => string;
}

type OptionalMessages = Partial<GoogleSearchMessages>;

const HEADLINE_LIMITS = GOOGLE_SEARCH_LIMITS.headlines;
const DESCRIPTION_LIMITS = GOOGLE_SEARCH_LIMITS.descriptions;

const finalUrl = (messages: OptionalMessages) =>
  z
    .string()
    .trim()
    .max(GOOGLE_SEARCH_LIMITS.finalUrl, messages.finalUrl)
    .pipe(z.url({ protocol: /^https?$/, error: messages.finalUrl }));

const headline = (messages: OptionalMessages) =>
  z
    .string()
    .trim()
    .min(1, messages.headlineRequired)
    .max(HEADLINE_LIMITS.length, messages.headlineTooLong);

const description = (messages: OptionalMessages) =>
  z
    .string()
    .trim()
    .min(1, messages.descriptionRequired)
    .max(DESCRIPTION_LIMITS.length, messages.descriptionTooLong);

/** The optional display path: empty or up to Core's length. */
const path = (messages: OptionalMessages) =>
  z.string().trim().max(GOOGLE_SEARCH_LIMITS.path, messages.pathTooLong);

/** Rules that span fields; absent values may be undefined or empty. */
function refineAcrossFields(
  value: {
    startDate?: string | undefined;
    endDate?: string | undefined;
    path1?: string | undefined;
    path2?: string | undefined;
    headlines: readonly string[];
  },
  ctx: z.RefinementCtx,
  messages: OptionalMessages,
): void {
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: messages.endBeforeStart ?? "End date is before the start date",
    });
  }
  if (value.path2?.trim() && !value.path1?.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["path2"],
      message: messages.pathNeedsFirst ?? "Path 2 needs path 1",
    });
  }
  const seen = new Set<string>();
  value.headlines.forEach((text, index) => {
    const key = text.trim().toLowerCase();
    if (key !== "" && seen.has(key)) {
      ctx.addIssue({
        code: "custom",
        path: ["headlines", index],
        message: messages.headlineDuplicate ?? "Headlines must be different",
      });
    }
    seen.add(key);
  });
}

/** Whether `YYYY-MM-DD` is a real day: 2026-02-31 is not. */
function isCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * Core's Search spec as the server action receives it, so a call that skips
 * the form still meets Core's limits. Google stays the authority on width
 * and policy.
 */
export function googleSearchSpecSchema(messages: OptionalMessages = {}) {
  const id = z.string().regex(/^\d{1,20}$/);
  const date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isCalendarDate);
  return z
    .object({
      type: z.literal("SEARCH"),
      startDate: date.optional(),
      endDate: date.optional(),
      locationIds: z.array(id).max(GOOGLE_SEARCH_LIMITS.targetIds),
      languageIds: z.array(id).max(GOOGLE_SEARCH_LIMITS.targetIds),
      finalUrl: finalUrl(messages),
      keywords: z
        .array(
          z.object({
            text: z
              .string()
              .trim()
              .min(1)
              .max(GOOGLE_KEYWORD_MAX_LENGTH)
              .refine(
                (text) => text.split(/\s+/).length <= GOOGLE_KEYWORD_MAX_WORDS,
              ),
            matchType: z.enum(GOOGLE_MATCH_TYPES),
          }),
        )
        .min(1, messages.keywordsRequired)
        .max(GOOGLE_KEYWORD_LIMIT, messages.keywordsTooMany),
      headlines: z
        .array(headline(messages))
        .min(HEADLINE_LIMITS.min)
        .max(HEADLINE_LIMITS.max),
      descriptions: z
        .array(description(messages))
        .min(DESCRIPTION_LIMITS.min)
        .max(DESCRIPTION_LIMITS.max),
      path1: path(messages).min(1).optional(),
      path2: path(messages).min(1).optional(),
    })
    .superRefine((value, ctx) => refineAcrossFields(value, ctx, messages));
}

/** What the Search part of the create page holds: text, as typed. */
export interface GoogleSearchFormValues {
  startDate: string;
  endDate: string;
  keywords: string;
  finalUrl: string;
  path1: string;
  path2: string;
  headlines: string[];
  descriptions: string[];
}

/** The same limits for the form's fields, in the reader's words. */
export function googleSearchFormSchema(messages: OptionalMessages = {}) {
  return z
    .object({
      startDate: z.string(),
      endDate: z.string(),
      keywords: z.string().superRefine((value, ctx) => {
        const { keywords, invalid } = parseGoogleKeywords(value);
        const first = invalid[0];
        if (first) {
          ctx.addIssue({
            code: "custom",
            message:
              messages.keywordsInvalid?.(first.line, first.issue) ??
              `Line ${first.line} is not a valid keyword`,
          });
        } else if (keywords.length === 0) {
          ctx.addIssue({ code: "custom", message: messages.keywordsRequired });
        } else if (keywords.length > GOOGLE_KEYWORD_LIMIT) {
          ctx.addIssue({ code: "custom", message: messages.keywordsTooMany });
        }
      }),
      finalUrl: finalUrl(messages),
      path1: path(messages),
      path2: path(messages),
      headlines: z.array(headline(messages)),
      descriptions: z.array(description(messages)),
    })
    .superRefine((value, ctx) => refineAcrossFields(value, ctx, messages));
}

/**
 * The Search spec for what the form holds. Targeting is empty until the
 * pickers exist, which Core reads as all countries and languages.
 */
export function toGoogleSearchSpec(
  values: GoogleSearchFormValues,
): GoogleSearchCampaignSpec {
  const path1 = values.path1.trim();
  const path2 = values.path2.trim();
  return {
    type: "SEARCH",
    ...(values.startDate ? { startDate: values.startDate } : {}),
    ...(values.endDate ? { endDate: values.endDate } : {}),
    locationIds: [],
    languageIds: [],
    finalUrl: values.finalUrl.trim(),
    keywords: parseGoogleKeywords(values.keywords).keywords,
    headlines: values.headlines.map((text) => text.trim()),
    descriptions: values.descriptions.map((text) => text.trim()),
    ...(path1 ? { path1 } : {}),
    ...(path1 && path2 ? { path2 } : {}),
  };
}

/**
 * The address as the ad shows it: the domain without `www.`, then up to two
 * display paths, `example.com/shoes/sale`. A path 2 without a path 1 is not
 * shown, as it is not sent. Before there is a valid final URL, `example.com`.
 */
export function adDisplayUrl(
  finalUrl: string,
  path1: string,
  path2: string,
): string {
  let domain = "example.com";
  try {
    domain = new URL(finalUrl.trim()).hostname.replace(/^www\./, "");
  } catch {
    // Still typing: the placeholder domain stands in.
  }
  const first = path1.trim();
  const second = first ? path2.trim() : "";
  return [domain, first, second].filter(Boolean).join("/");
}
